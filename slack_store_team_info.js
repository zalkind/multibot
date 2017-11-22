'use strict';
const util = require('util');

var Cloudant = require('cloudant');

var username = process.env.CLOUDANT_USERNAME;
var password = process.env.CLOUDANT_PASSWORD;
var use_default = true;

Cloudant({account:username, password:password}, function(err, cloudant) {
  if (err) {
    return console.log('[SLACK] Failed to initialize Cloudant: ' + err.message);
  }

  try {
    store = cloudant.db.use("team_info");
  } catch (err) {
    cloudant.db.create('team_info');
    store = cloudant.db.use("team_info");
  }
  console.log('Using cloudant team_info storage.');
  use_default = false;
});

var store = {}

function getTeamInfoHooks() {
  if (use_default) return null;

  console.log('[SLACK] Getting team_info hooks!');  
  var storeTeamInfoHooks = {};
  storeTeamInfoHooks.storeTeamInfo = function storeTeamInfo(bot, teamInfo) {
    console.log('[SLACK] storing team info: ' + util.inspect(teamInfo, false, null));
    return new Promise((resolve, reject) => {
      store.get(teamInfo.team_id, (err, data) => {
        var doc = { _id: teamInfo.team_id.toString() };
        if (!err) {
          doc = data;
        }
        doc.teamInfo = teamInfo;
        store.insert(teamInfo.team_id, teamInfo, (err) => {
          if (err) {
            return reject(err);
          }
          return resolve(teamInfo);
        });
      });
    });
  };

  this.storeTeamInfoHooks.getTeamInfo = function getTeamInfo(bot, teamId) {
    console.log('[SLACK] retrieving team info: ' + util.inspect(teamId, false, null));
    return new Promise((resolve, reject) => {
      store.get(teamId, (err, teamInfo) => {
        if (err) {
          return reject(`[SLACK] An error occurred trying to get info for: ${teamId}`);
        }
        return resolve(teamInfo);
      });
    });
  };

  return storeTeamInfoHooks();
}

module.exports = {
  getTeamInfoHooks,
};



