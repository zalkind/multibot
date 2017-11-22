#!/usr/bin/env ruby
# IBM SDK for Node.js Buildpack
# Copyright 2014 the original author or authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# points to /home/vcap/app
app_dir = File.expand_path('..', File.dirname(__FILE__))

app_mgmt_dir = File.join(app_dir, '.app-management')

$LOAD_PATH.unshift app_mgmt_dir

require 'json'
require 'utils/enabled_handlers'
require 'utils/handlers'
require 'utils/simple_logger'

def start_runtime(app_dir)
  exec(".app-management/scripts/start #{ENV['PORT']}", chdir: app_dir)
end

def start_proxy(app_dir)
  exec('.app-management/bin/proxyAgent', chdir: app_dir)
end

def get_environment(app_mgmt_dir, app_dir)
  env = {}
  env['BOOT_SCRIPT'] = ENV['BOOT_SCRIPT']
  env['BLUEMIX_DEV_CONSOLE_HIDE'] = '["stop"]'
  env['BLUEMIX_DEV_CONSOLE_START_TIMEOUT'] = '500'
  if system "bash -c \"source #{app_mgmt_dir}/utils/node_utils.sh && inspector_builtin #{app_dir}/vendor/node\""
    env['BLUEMIX_DEV_CONSOLE_TOOLS'] = '[ {"name":"shell", "label":"Shell"} ]'
  else
    env['BLUEMIX_DEV_CONSOLE_TOOLS'] = '[ {"name":"shell", "label":"Shell"}, {"name": "inspector", "label": "Debugger"} ]'
  end
  env
end

def run(app_dir, env, handlers, background)
  if handlers.length != 0
    command = handlers.map { | handler | handler.start_script }.join(' ; ')
    command = "( #{command} ) &" if background
    system(env, "#{command}", chdir: app_dir)
  end
end

def run_handlers(app_mgmt_dir, app_dir, handlers, valid_handlers, invalid_handlers)
  Utils::SimpleLogger.warning("Ignoring unrecognized app management utilities: #{invalid_handlers.join(', ')}") unless invalid_handlers.empty?
  Utils::SimpleLogger.info("Activating app management utilities: #{valid_handlers.join(', ')}")

  # get environment for handlers
  env = get_environment(app_mgmt_dir, app_dir)

  # sort handlers for sync and async execution
  sync_handlers, async_handlers = handlers.executions(valid_handlers)

  # execute sync handlers
  run(app_dir, env, sync_handlers, false)

  # execute async handlers
  run(app_dir, env, async_handlers, true)
end

def write_json(file, key, value)
  hash = JSON.parse(File.read(file))
  hash[key] = value
  File.open(file,"w") do |f|
    f.write(hash.to_json)
  end
end

handler_list = Utils.get_enabled_handlers

if handler_list.nil? || handler_list.empty?
  # No handlers are specified. Start the runtime normally.
  start_runtime(app_dir)
else
  handlers_dir = File.join(app_mgmt_dir, 'handlers')

  handlers = Utils::Handlers.new(handlers_dir)

  # validate headers
  valid_handlers, invalid_handlers = handlers.validate(handler_list)

  # check if proxy agent is required
  proxy_required = handlers.proxy_required?(valid_handlers)

  if proxy_required
    # check instance index
    index = JSON.parse(ENV['VCAP_APPLICATION'])['instance_index']
    if index != 0
      # Start the runtime normally. Only allow dev mode on index 0
      start_runtime(app_dir)
    else
      # Run handlers
      run_handlers(app_mgmt_dir, app_dir, handlers, valid_handlers, invalid_handlers)

      # Start proxy
      write_json(File.join(app_mgmt_dir, 'app_mgmt_info.json'), 'proxy_enabled', 'true')
      start_proxy(app_dir)
    end
  else
    # Run handlers
    run_handlers(app_mgmt_dir, app_dir, handlers, valid_handlers, invalid_handlers)

    # Start runtime
    start_runtime(app_dir)
  end
end
