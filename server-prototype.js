
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const EXPRESS = require("express");
const EXPRESS_SESSION = require("express-session");
const REQUEST = require("request");
const DEEPMERGE = require("deepmerge");
const CONNECT_MEMCACHED = require("connect-memcached");
const MEMCACHED = require('memcached');
const COOKIE_PARSER = require("cookie-parser");
const BODY_PARSER = require("body-parser");
const MORGAN = require("morgan");
const METHOD_OVERRIDE = require("method-override");
const WAITFOR = require("waitfor");
const Q = require("q");
const DOT = require("dot");
const SEND = require("send");
const RETHINKDB = require("rethinkdb");


var PORT = process.env.PORT || 8080;


exports.for = function(module, packagePath, preAutoRoutesHandler) {

	var exports = module.exports;

	exports.main = function(callback) {

		try {
	
		    var pioConfig = FS.readJsonSync(PATH.join(packagePath, "../.pio.json"));

		    var app = EXPRESS();

	        app.use(MORGAN());
	        app.use(COOKIE_PARSER());
	        app.use(BODY_PARSER());
	        app.use(METHOD_OVERRIDE());
			if (
				pioConfig.config["pio.service"].config &&
				pioConfig.config["pio.service"].config.memcachedHost
			) {
				var sessionStore = new (CONNECT_MEMCACHED(EXPRESS_SESSION))({
					prefix: "op-identity-provider-server-nodejs",
					hosts: [
						pioConfig.config["pio.service"].config.memcachedHost
					]
				});
				app.use(EXPRESS_SESSION({
					secret: 'session secret',
					key: 'sid',
					proxy: 'true',
					store: sessionStore
				}));
				if (!app.helpers) {
					app.helpers = {};
				}
				app.helpers.destroyAllSessions = function() {
					sessionStore.prefix = originalSessionPrefix + Date.now() + "-";
				}
			}
			
			var r = null;
			if (
				pioConfig.config["pio.service"].config &&
				pioConfig.config["pio.service"].config.rethinkdbHost
			) {
				r = Object.create(RETHINKDB);
				var tableEnsure__pending = [];
			    r.tableEnsure = function (DB_NAME, TABLE_NAME, tableSuffix, options, callback, _previous) {
			    	if (typeof options === "function") {
			    		_previous = callback;
			    		callback = options;
			    		options = null;
			    	}
			    	options = options || {};
			    	if (tableEnsure__pending !== false) {
			    		tableEnsure__pending.push([DB_NAME, TABLE_NAME, tableSuffix, options, callback, _previous]);
			    		return;
			    	}
			        return r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix).run(r.conn, function(err) {
			            if (err) {
			                if (/Database .+? does not exist/.test(err.msg)) {
			                    if (_previous === "dbCreate") return callback(err);
			                    return r.dbCreate(DB_NAME).run(r.conn, function (err) {
			                        if (err) {
console.log("err.msg", err.msg);
						                if (/Database .+? already exists/.test(err.msg)) {
						                	// Ignore. Someone else beat us to it!
						                	console.error("Ignoring database exists error!");
						                } else {
				                        	return callback(err);
						                }
			                        }
			                        return r.tableEnsure(DB_NAME, TABLE_NAME, tableSuffix, options, callback, "dbCreate");
			                    });
			                }
			                if (/Table .+? does not exist/.test(err.msg)) {
			                    if (_previous === "tableCreate") return callback(err);
			                    return r.db(DB_NAME).tableCreate(TABLE_NAME + "__" + tableSuffix).run(r.conn, function (err) {
			                        if (err) {
console.log("err.msg", err.msg);
						                if (/Table .+? already exists/.test(err.msg)) {
						                	// Ignore. Someone else beat us to it!
						                	console.error("Ignoring table exists error!");
						                } else {
				                        	return callback(err);
						                }
			                        }
			                        return r.tableEnsure(DB_NAME, TABLE_NAME, tableSuffix, options, callback, "tableCreate");
			                    });
			                }
			                return callback(err);
			            }
			            function ensureIndexes(callback) {
				            if (!options.indexes) {
				            	return callback(null);
				            }					            
				            return r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix).indexList().run(r.conn, function (err, result) {
				                if (err) return callback(err);
					            var waitfor = WAITFOR.parallel(callback);
					            options.indexes.forEach(function(indexName) {
					            	if (result.indexOf(indexName) !== -1) {
					            		return;
					            	}
					            	waitfor(function(callback) {
					            		console.log("Creating index", indexName, "on table", TABLE_NAME + "__" + tableSuffix);
							            return r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix).indexCreate(indexName).run(r.conn, function (err, result) {
					                        if (err) {
console.log("err.msg", err.msg);
								                if (/Index .+? already exists/.test(err.msg)) {
								                	// Ignore. Someone else beat us to it!
								                	console.error("Ignoring index exists error!");
								                } else {
						                        	return callback(err);
								                }
					                        }
						            		return callback(null);
						            	});
					            	});
					            });
					            return waitfor();
					        });
			            }
			            return ensureIndexes(function(err) {
			            	if (err) return callback(err);
				            return callback(null, r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix));
			            });
			        });
			    }
			    r.getCached = function (DB_NAME, TABLE_NAME, tableSuffix, key, callback) {
			        return r.tableEnsure(DB_NAME, TABLE_NAME, tableSuffix, function(err, table) {
			            if (err) return callback(err);
			            return table.get(key).run(r.conn, function (err, result) {
			                if (err) return callback(err);
			                if (result) {
			//                    console.log("Using cached data for key '" + key + "':", result.data);
			                    return callback(null, result.data);
			                }
			                return callback(null, null, function (data, callback) {
			                    return table.insert({
			                        id: key,
			                        data: data
			                    }, {
			                        upsert: true
			                    }).run(r.conn, function (err, result) {
			                        if (err) return callback(err);
			                        return callback(null, data);
			                    });
			                });
			            });
			        });
			    }
			    function connectToRethinkDB() {
			    	function reconnect() {
			    		console.log("Reconnect scheduled ...");
			    		setTimeout(function () {
			    			connectToRethinkDB();
			    		}, 2000);
			    	}
			    	console.log("Try to connect to RethinkDB ...");
					RETHINKDB.connect({
						host: pioConfig.config["pio.service"].config.rethinkdbHost.split(":")[0],
						port: parseInt(pioConfig.config["pio.service"].config.rethinkdbHost.split(":")[1])
					}, function(err, conn) {
						if(err) {
							console.error("Error connecting to RethinkDB host: " + pioConfig.config["pio.service"].config.rethinkdbHost, err);
							return reconnect();
					  	}
  						r.conn = conn;

  						conn.once("close", function () {
  							console.log("DB connection closed!");
  							return reconnect();
  						});

						console.log("Now that DB is connected run pending queries ...");
						var pending = tableEnsure__pending;
						tableEnsure__pending = false;
						if (pending) {
							pending.forEach(function (call) {
								r.tableEnsure.apply(r, call);
							});
						}
					});
				}					
				connectToRethinkDB();
				app.use(function(req, res, next) {
					if (r) {
						res.r = r;
					}
					return next();
				});
			}

			app.use(function (req, res, next) {
		        var origin = null;
		        if (req.headers.origin) {
		            origin = req.headers.origin;
		        } else
		        if (req.headers.host) {
		            origin = [
		                (PORT === 443) ? "https" : "http",
		                "://",
		                req.headers.host
		            ].join("");
		        }
		        res.setHeader("Access-Control-Allow-Methods", "GET");
		        res.setHeader("Access-Control-Allow-Credentials", "true");
		        res.setHeader("Access-Control-Allow-Origin", origin);
		        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cookie");
		        if (req.method === "OPTIONS") {
		            return res.end();
		        }
		        return next();
			});
			
	        if (preAutoRoutesHandler) {
	        	preAutoRoutesHandler(app, pioConfig.config["pio.service"], {
	        		API: {
	        			FS: FS,
	        			EXPRESS: EXPRESS,
						DEEPMERGE: DEEPMERGE,
						WAITFOR: WAITFOR,
						Q: Q,
						REQUEST: REQUEST,
						SEND: SEND
	        		}
	        	});
	        }

	        // Default routes inserted by config.

		    app.get("/favicon.ico", function (req, res, next) {
		    	return res.end();
		    });

		    function processRequest(requestConfig, req, res, next) {

	    		var pathname = req._parsedUrl.pathname;
	    		if (pathname === "/") pathname = "/index";

	    		function formatPath(callback) {

	    			function checkExtensions(originalPath, callback) {
			    		return FS.exists(originalPath, function(exists) {
			    			if (/\/[^\/]+\.[^\.]+$/.test(pathname)) {
				    			return callback(null, originalPath, exists);
			    			}
			    			if (!exists) {
			    				var path = originalPath;
			    				if (pathname === "/index") {
			    					pathname += ".html";
			    					path += ".html";
			    				} else {
			    					pathname += ".htm";
			    					path += ".htm";
			    				}
					    		return FS.exists(path, function(exists) {
					    			return callback(null, path, exists);
					    		});
			    			}
			    			return callback(null, originalPath, true);
			    		});
	    			}

	    			return checkExtensions(PATH.join(packagePath, "www", pathname), callback);
	    		}

		    	return formatPath(function(err, path, pathExists) {
		    		if (err) return next(err);
	    			if (!pathExists) {
	    				return next();
	    			}
					return FS.readFile(path, "utf8", function(err, templateSource) {
						if (err) return callback(err);

						// TODO: Get own instance: https://github.com/olado/doT/issues/112
                        DOT.templateSettings.strip = false;
                        DOT.templateSettings.varname = "view";
                        var compiled = null;
                        try {
                            compiled = DOT.template(templateSource);
                        } catch(err) {
							console.error("templateSource", templateSource);
                        	console.error("Error compiling template: " + path);
                            return callback(err);
                        }

						var result = null;
                        try {
                            result = compiled(res.view || {});
                        } catch(err) {
                        	console.error("Error running compiled template: " + path);
                            return next(err);
                        }

                        // TODO: Send proper headers.
                        res.writeHead(200, {
                        	"Content-Type": "text/html",
                        	"Content-Length": result.length
                        });
                        return res.end(result);
					});
	    		});
		    }

		    app.post(/^\//, function(req, res, next) {
		    	if (req.headers["x-config"] === "in-body") {
					return processRequest(req.body, req, res, next);
		    	}
		    	return next();
		    });

		    app.get(/^\//, function(req, res, next) {
		    	return processRequest(false, req, res, next);
		    });


			var server = app.listen(PORT);

			console.log("Listening at: http://localhost:" + PORT);

		    return callback(null, {
		        server: server
		    });
		} catch(err) {
			return callback(err);
		}
	}

	if (require.main === module) {
		return exports.main(function(err) {
			if (err) {
				console.error(err.stack);
				process.exit(1);
			}
			// Keep server running.
		});
	}
}


exports.for(module, __dirname);

