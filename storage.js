'use strict';
const util = require('util');
var extend = require('extend');

var Cloudant = require('cloudant');

var username = process.env.CLOUDANT_USERNAME;
var password = process.env.CLOUDANT_PASSWORD;
var inMemory = true;

Cloudant({account:username, password:password}, function(err, cloudant) {
  if (err) {
    return console.log('Failed to initialize Cloudant: ' + err.message);
  }

  try {
    store = cloudant.db.use("context_store");
    store.get('_design/unique_id', function(err, data) {
      if (err) {
        var indexer = function(doc) {
          if (doc.session && doc.session.context && doc.session.context.cpf) {
            index('cpf', doc.session.context.cpf);
          }
        }
        var ddoc = {
          _id: '_design/unique_id',
          indexes: {
            contexts: {
              analyzer: {cpf: 'standard'},
              index   : indexer
            }
          }
        };
        store.insert(ddoc, function (er, result) {
          if (er) {
            throw er;
          }
          console.log('Created design document with unique_id index');
        });
      }
    });
  } catch (err) {
    cloudant.db.create('context_store');
    store = cloudant.db.use("context_store");
  }

  inMemory = false;
});

var store = {};

function retrieveSession(bot, update, user_name, channel, handleConversationCallback) {
  console.log('Retrieving session');
  // try to retrieve the session object for a certain id
  // if no session is found, set the session to an empty object
  var unique_id = update.sender.id.toString();
  console.log('SEARCHING FOR SENDER.ID THEN UNIQUE_ID');
  if (inMemory) {
    if (store[unique_id]) {
      update.session = store[unique_id];
    }
    else {
      if (user_name) {
        update.session = {context: {channel: channel, timezone: 'America/Sao_Paulo', user_name: user_name}};
      } else {
        update.session = {context: {channel: channel, timezone: 'America/Sao_Paulo'}};
      }
    }
    handleConversationCallback(bot, update);
  }
  else {
    store.get(unique_id, function(err, data) {
      if (err) {
        if (user_name) {
          update.session = {context: {channel: channel, timezone: 'America/Sao_Paulo', user_name: user_name}};
        } else {
          update.session = {context: {channel: channel, timezone: 'America/Sao_Paulo'}};
        }
      }
      else {
        console.log('Got session by sender.id');
        update.session = data.session;
      }
      handleConversationCallback(bot, update);
    });
  }
}

function updateSession(bot, message) {
  // update or store the session for the first time.
  // the update is expected to be found in the message object
  // for the platform. Because we don't need to send it over,
  // we delete it after saving the session.
  if (message.sender_action == 'typing_on' || !message.session) next();
  else {
    var unique_id = message.recipient.id.toString();
    console.log("MESSAGE: " + util.inspect(message, false, null));
    if (message.hasOwnProperty('session') && message.session.hasOwnProperty('context') && message.session.context.hasOwnProperty('cpf') && message.session.context.cpf) {
      console.log('Got CPF to store context');
      unique_id = message.session.context.cpf.toString();
      if (inMemory) {
        store[message.recipient.id] = message.session;
        console.log('Stored context for unique_id ' + unique_id);
      }
      else {
        var aggregated_context = message.session;
        store.find({selector: {"session.context.cpf": unique_id}}, function(er, result) {
          if (!er) {
            for (var i = 0; i < result.docs.length; i++) {
              if (result.docs[i].session.hasOwnProperty('context') && result.docs[i].session.context.hasOwnProperty('user_name') && !message.session.context.hasOwnProperty('user_name')) {
                console.log('FOUND USERNAME IN DOC ' + result.docs[i]._id + ' -> ' + result.docs[i].session.context.user_name);
                message.session.context.user_name = result.docs[i].session.context.user_name;
              }
              else if (message.session.context.hasOwnProperty('user_name') && message.session.context.user_name) {
                console.log('DID NOT FIND RECORDS WITH USERNAME, BUT SESSION ALREADY HAS: ' + message.session.context.user_name);
              }
              aggregated_context = extend(true, aggregated_context, result.docs[i].session, message.session);
              // aggregated_context = Object.assign(aggregated_context, result.docs[i].session, message.session);
            }
            console.log('AGGREGATED CONTEXT: ' + util.inspect(aggregated_context, false, null));
          }
        });
        store.find({selector: {"session.context.cpf": unique_id}}, function(er, result) {
          if (!er && result.docs.length > 0) {
            console.log('Showing %d contexts with unique_id %s', result.docs.length, unique_id);
            for (var i = 0; i < result.docs.length; i++) {
              if (result.docs[i]._id != message.recipient.id.toString()) {
                store.get(result.docs[i]._id, function(err, data) {
                  if (!err) {
                    var doc = data;
                    if (doc.hasOwnProperty('session')) {
                      doc.session = extend(true, doc.session, aggregated_context);
                      // doc.session = Object.assign(doc.session, aggregated_context);
                    }
                    else {
                      doc.session = aggregated_context;
                    }
                    console.log('Document id: %s', doc._id);
                    console.log('DOC: ' + util.inspect(doc, false, null));
                    store.insert(doc, function(err, data) {
                      if (err) {
                        return console.log("[Context_Store] Error:", err);
                      }
                      console.log("[Context_Store] Unique_id:" + unique_id + " Data:", data);
                    });
                  }
                });
              }
            }
            store.get(message.recipient.id.toString(), function(err, data) {
              var doc = { _id: message.recipient.id.toString() };
              if (!err) {
                doc = data;
                doc._id = message.recipient.id.toString();
              }
              if (doc.hasOwnProperty('session')) {
                 doc.session = extend(true, doc.session, aggregated_context);
                 // doc.session = Object.assign(doc.session, aggregated_context);
              }
              else {
                doc.session = message.session;
              }
              store.insert(doc, function(err, data) {
                if (err) {
                  return console.log("[Context_Store] Error:", err);
                }
              });
            });
          }
          else {
            console.log('INDEX ERROR: ' + er);
            store.get(message.recipient.id.toString(), function(err, data) {
              var doc = { _id: message.recipient.id.toString() };
              if (!err) {
                doc = data;
                doc._id = message.recipient.id.toString();
              }
              if (doc.hasOwnProperty('session')) {
                 doc.session = extend(true, doc.session, aggregated_context);
                 // doc.session = Object.assign(doc.session, aggregated_context);
              }
              else {
                doc.session = message.session;
              }
              store.insert(doc, function(err, data) {
                if (err) {
                  return console.log("[Context_Store] Error:", err);
                }
              });
            });
          }
        });
      }
    }
    else {
      if (inMemory) {
        store[unique_id] = message.session;
        console.log('Stored context for ' + unique_id + ': ' + util.inspect(store[unique_id], false, null));
      }
      else {
        store.get(unique_id, function(err, data) {
          var doc = { _id: unique_id };
          if (!err) {
            doc = data;
            doc._id = unique_id;
          }
          doc.session = message.session;
          store.insert(doc, function(err, data) {
            if (err) {
              return console.log("[Context_Store] Error:", err);
            }
            console.log("[Context_Store] Unique_id:" + unique_id + " Data:", data);
          });
        });
      }
    }
  }
}

module.exports = {
  retrieveSession,
  updateSession,
};
