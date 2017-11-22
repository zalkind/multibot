'use strict'
const util = require('util');

const Botmaster = require('botmaster');
const watson = require('watson-developer-cloud');
const storage = require('./storage');
//const slack_team_info = require('./slack_store_team_info');
const cfenv = require('cfenv');
const Buttons = require('./buttons')
const Stickers = require('./stickers')
const Context = require('./context');
const Output = require('./output');
const Input = require('./input');
const Cloudant = require('./cloudant');
const rp = require('request-promise');
const striptags = require('striptags');
const Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();

// get the app environment from Cloud Foundry
const appEnv = cfenv.getAppEnv();

const watsonConversation = watson.conversation({
  username: process.env.WATSON_CONVERSATION_USERNAME,
  password: process.env.WATSON_CONVERSATION_PASSWORD,
  version: 'v1',
  version_date: '2016-09-20',
});

// bot configuration
const telegramSettings = {
  credentials: {
    authToken: process.env.TELEGRAM_AUTH_TOKEN,
  },
  webhookEndpoint: process.env.TELEGRAM_WEBHOOKENDPOINT,
};

const messengerSettings = {
  credentials: {
    verifyToken: process.env.MESSENGER_VERIFY_TOKEN,
    pageToken: process.env.MESSENGER_PAGE_TOKEN,
    fbAppSecret: process.env.MESSENGER_APP_SECRET,
  },
  webhookEndpoint: process.env.MESSENGER_WEBHOOKENDPOINT,
};

const slackSettings = {
  credentials: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    verificationToken: process.env.SLACK_VERIFICATION_TOKEN
  },
  webhookEndpoint: process.env.SLACK_WEBHOOKENDPOINT,
  storeTeamInfoInFile: true,
};
//console.log('Slack Credentials: ' + util.inspect(slackSettings, false, null));
//console.log('Retrieving team_info webhooks!');
//var team_info_hooks = slack_team_info.getTeamInfoHooks();
//console.log('Got it!');
//if (team_info_hooks != null) {
//  slackSettings.storeTeamInfoHooks = team_info_hooks;
//  storeTeamInfoInFile = false;
//}

const twitterSettings = {
  credentials: {
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: process.env.TWITTER_TOKEN_SECRET,
  }
}

/*
 * Where the actual code starts. This code is actually all that is required
 * to have a bot that works on the various different channels and that
 * communicates with the end user using natural language (from Watson Conversation).
 * If a conversation is properly trained on the system, no more code is required.
 */
const botsSettings = [{
  telegram: telegramSettings
}, {
  messenger: messengerSettings
}, {
  slack: slackSettings
}, {
  twitter: twitterSettings
}];
const express = require('express');
const bots = express();
const bodyParser = require('body-parser');
bots.use(bodyParser.json());
bots.use(bodyParser.urlencoded({
  extended: true
}));
const botmasterSettings = {
  botsSettings,
  app: bots,
    port: appEnv.isLocal ? 3000 : appEnv.port,
};
const delay = 1200;
const botmaster = new Botmaster(botmasterSettings);

botmaster.app.use('/slack', express.static(__dirname + '/views/slack')); // added

botmaster.on('update', (bot, update) => {
  var user_name = '';
  if (update.hasOwnProperty('session') && update.session.hasOwnProperty('context')) {
    if (update.session.context.hasOwnProperty('user_name') && update.session.context.user_name) {
      user_name = update.session.context.user_name;
    }
  }

  if (bot.type === 'messenger' && user_name === '') {
    var options = {
      uri: 'https://graph.facebook.com/v2.7/'+update.sender.id,
       qs: { access_token: messengerSettings.credentials.pageToken, fields: 'first_name' },
       method: 'GET',
       json: true
    };
    rp(options).then((data) => {
      console.log('  User name for user_id ' + update.sender.id + ' = ' + data.first_name);
      user_name = data.first_name;
      if (user_name) {
        user_name = ' ' + user_name + ' ';
      }
      storage.retrieveSession(bot, update, user_name, bot.type, handleUserInteraction);
    }).catch((err) => {
      console.log('Error updating user_name: ', err);
    });
  }
  else {
    storage.retrieveSession(bot, update, user_name, bot.type, handleUserInteraction);
  }
});

function handleUserInteraction(bot, update) {
  var context = update.session.context;
  var optionalDelay = 0;
  var firstText = "";

  setTimeout(function() {
    var input = "";
    if (update.message.text) {
      input = JSON.stringify(update.message.text);
      //Remove quotation marks
      input = input.substring(1, input.length - 1);
      //Replace \n
      input = input.replace(/\\n/g, " ");
      input = Input.replaceTagsUserInput(input);
    }
    const messageForWatson = {
      context,
      workspace_id: process.env.WORKSPACE_ID,
        input: {
          text: input,
        },
    };
    //THIS LINE READS THE USER INPUT (USEFUL TO DETERMINE STICKERS ID)
    //bot.sendTextMessageTo(String(JSON.stringify(update.message)),update.sender.id);
    if (update.message.sticker_id && Stickers.reactToStickers(update.message
        .sticker_id)) {
      var reaction = Stickers.reactToStickers(update.message.sticker_id);
      //Send is typing status...
      setTimeout(function() {
        bot.sendIsTypingMessageTo(update.sender.id);
      }, optionalDelay + 250);
      //Support attachments
      if (reaction.attachment) {
        const message = {
          recipient: {
            id: update.sender.id,
          },
          message: {
            text: reaction.text
          },
          attachment: {
            type: "image",
            payload: {
              url: reaction.attachment
            }
          }
        };
        bot.sendMessage(message);
      } else {
        setTimeout(function() {
          bot.sendTextMessageTo(reaction.text, update.sender.id);
        }, optionalDelay + delay);
      }
    } else {
      setTimeout(function() {
        watsonConversation.message(messageForWatson, (err, watsonUpdate) => {
          Context.setContextAfterWatson(watsonUpdate);
          update.session.context = watsonUpdate.context;

          var messages = [];
          for (var i = 0; i < watsonUpdate.output.text.length; i++) {
            watsonUpdate.output.text[i] = Output.replaceTags(
              watsonUpdate.output.text[i]);
            var msgs = watsonUpdate.output.text[i].split(/<br\ ?\/>/g);
            for (var idx = 0; idx < msgs.length; idx++) {
              var text = msgs[idx];
              if (text.length > 320) {
                var regex = /(.*?)<ul>(.*?)<\/ul>(.*)/;
                var r = text.match(regex);
                if (r) {
                  var pre = r[1];
                  var lst = r[2];
                  var pos = r[3];
                  if (pre) messages.push(striptags(pre));
                  if (lst) {
                      regex = /<li>(.*?)<\/li>+?/g;
                      r = lst.match(regex);
                      if (r) {
                          for (var k = 0; k < r.length; k++) {
                              if (r[k]) messages.push(' - ' + striptags(r[k]));
                          }
                      }
                  }
                  if (pos) messages.push(striptags(pos));
                }
                else {
                  var fields = text.split(" ");
                  var part = ""; 
                  var first = true;
                  for (var j = 0; j < fields.length; j++) {
                    if (part.length + fields[j].length + 1 > 315) {
                      messages.push(part + ' ...');
                      first = false;
                      part = "...";
                    }   
                    part = part + ' ' + fields[j];
                  }   
                  messages.push(part);
                }
              }
              else {
                var regex = /(.*?)<ul>(.*?)<\/ul>(.*)/;
                var r = text.match(regex);
                if (r) {
                  var pre = r[1];
                  var lst = r[2];
                  var pos = r[3];
                  if (pre) messages.push(striptags(pre));
                  if (lst) {
                      regex = /<li>(.*?)<\/li>+?/g;
                      r = lst.match(regex);
                      if (r) {
                          for (var k = 0; k < r.length; k++) {
                              if (r[k]) messages.push(' - ' + striptags(r[k]));
                          }
                      }
                  }
                  if (pos) messages.push(striptags(pos));
                }
                else {
                  messages.push(striptags(text));
                } 
              }
            }
          }

          for (var i = 0; i < messages.length; i++) {
            var text = messages[i];
            if (text !== firstText) {
              setTimeout(function() {
                bot.sendIsTypingMessageTo(update.sender.id);
              }, optionalDelay + delay * i + 250);
              var sz_offset = 0; //text.length / 320;
              setTimeout(function(txt) {
                const message = {recipient: {id: update.sender.id,}, message: {text: txt,}, session: update.session,};
                var buttons = Buttons.sendWithButtons(txt);
                if (buttons) {
                  message.message.quick_replies = [];
                  for (var btn_idx = 0; btn_idx < buttons.length; btn_idx++) {
                    message.message.quick_replies.push({content_type: 'text', title: buttons[btn_idx], payload: buttons[btn_idx]});
                  }
                }
                bot.sendMessage(message, (err, body) => {
                  if (err) {
                    console.log('[LINE 289] MESSAGE: ' + util.inspect(message, false, null));
                    console.log('[LINE 290] BODY: ' + body);
                    return console.log('[LINE 291] ERROR: ' + err + ' - ' + err.message);
                  }
                  storage.updateSession(bot, message);
                });
              }, optionalDelay + delay * (i + 1) * (1 + sz_offset), text);
            }
          }
          Cloudant.updateMessage(messageForWatson, watsonUpdate);
        })
      }, optionalDelay);
    }
  }, optionalDelay / 3);
  Cloudant.saveLastMessage();
}

botmaster.on('error', (bot, err) => {
  console.log(bot.type);
  console.log(err.stack);
});

module.exports = bots;
