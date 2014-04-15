/*
 * Create connection to server through sockets
 *
 * @param {String} Url of server
 * @param {Object} Options for socket.io connection
 */

var Waterbase = function (url, options, onchange) {
  this.url = url || 'http://localhost';
  this.onchange = onchange || function(){};
  this.options = options || {
    // Default Options
    'force new connection': true,
  };

  // Open Socket Connection
  this.connection = io.connect(url, this.options);
};

/**
 * Create Instance of Collection Class
 *
 * @param {String} collectionName of the collection
 * @param {Function} Callback when successfull
 * @return {collection} reference to collection
 */

Waterbase.prototype.collection = function (collectionName, callback) {
  return new Collection(collectionName, this.connection, callback, this.onchange);
};

/**
 * Class: Collection
 *
 * @param {String} name Collection name
 * @param {Connection} Reference to socket
 */

var Collection = function (name, connection, callback, onchange) {
  this.name = name;
  this.io = connection;

  this.onchange = onchange;

  this._storage = [];

  this.init(callback);
};

Collection.prototype.init = function(callback) {
  var collection = this;

  this.io.on('connect', function () {
    console.log('connected to socket server.');
    if (callback) callback();

    // Retrieve all models on start
    collection.retrieveAll();

    // Data Binding Listener
    collection.io.on('broadcast', function (eventType, data) {
      // Retrieve newly created model from server
      if (eventType === 'create') {
        console.log('Event "create": ModelID', data[0]._id, 'in', collection.name);
        collection.retrieveOne(data[0]._id);
      }

      // Delete all models from local collection
      else if (eventType === 'deleteAll') {
        data.forEach(function (name) {
          if (collection.name === name) {
            console.log('Event "deleteAll": Collection' + collection.name + ' emptied.');
            collection.retrieveAll(function () {
            });
            // collection._storage = [];
          }
        });
      }

      // Delete single model from local collection
      else if (eventType === 'deleteOne') {
        collection._storage.forEach(function (model, index) {
          console.log(data);
          if (data[0]._id === model._id) {
            console.log('Event "deleteOne": ModelID', data[0]._id, 'from', collection.name);
            collection._storage.splice(index, 1);
          }
        });
      }

      //data binding update trigger
      collection.onchange();
    });
  });
};

Collection.prototype.list = function() {
  return this._storage;
};

Collection.prototype.show = function(id) {
  var result;

  this._storage.forEach(function (model) {
    if (model._id === id) {
      result = model;
    }
  });

  return result;
};

/**
 * Gets all models in collection from server
 *
 * @param {Function} callback passed response data
 */

Collection.prototype.retrieveAll = function(callback) {
  var collection = this;

  this.io.emit(
    'retrieveAll',
    this.name,
    this.handleResponse(function (data) {
      console.log('Retrieved all models in', collection.name);
      collection._storage.length = 0;

      data.forEach(function (props, index) {
        collection._storage.push(new Model(props, collection.name, collection.io, collection.onchange));
      });

      collection.onchange()

      if (callback) callback(data);
    })
  );
};

/**
 * Gets single document from collection
 *
 * @param {Object} obj Describe requrested document
 * @param {Function} callback Use response data
 */

Collection.prototype.retrieveOne = function(id, callback) {
  if (!id) {
    throw 'first argument should be an model ID';
  }

  var collection = this;

  this.io.emit(
    'retrieveOne',
    this.name,
    id,
    this.handleResponse(function (data) {
      var model = new Model(data, collection.name, collection.io, collection.onchange);
      collection._storage.push(model);

      if (callback) callback(model);
    })
  );
};

/**
 * Create new document in collection
 *
 * @param {Function} callback to returned data
 */

Collection.prototype.create = function(set, callback) {
  if (!set) {
    throw 'first argument should be an object';
  }

  var collection = this;
  console.log(this, this.name);
  this.io.emit(
    'create',
    this.name,
    set,
    this.handleResponse(function (data) {
      if (callback) callback(data);
    })
  );
};

Collection.prototype.update = function(where, set, callback) {
  if (!where || !set) {
    throw 'first two arguments should be objects';
  } else if (!callback) {
    throw 'third argument should be a callback';
  }

  var collection = this;

  this.io.emit(
    'update',
    this.name,
    where,
    set,
    this.handleResponse(function (data) {
      if (callback) callback(data);
    })
  );
};

Collection.prototype.deleteAll = function(callback) {
  this.io.emit(
    'deleteAll',
    this.name,
    this.handleResponse(function (deleted) {
      if (callback) callback();
    })
  );
};

Collection.prototype.handleResponse = function(callback) {
  var collection = this;
  return function (err, data) {
    if (err) {
      throw err;
    } else {
      if (callback) callback(data);
    }
    //data binding update trigger
    collection.onchange();
  };
};

var bindProperty = function (property, value, context) {
  var prefix = '__bound';

  Object.defineProperty(context, prefix + property, {
      value: value,
      writable: true
    });

  Object.defineProperty(context, property, {
    get: function () {
      return this[prefix + property];
    },
    set: function (value) {
      var context = this;
      var set = {};

      set[property] = value;
      this.update(set, function (data) {
        context[prefix + property] = value;
      });
    }
  });
};

/**
 * Class: Model
 *
 * @param {Object} obj Data for new model
 * @param {String} Collection model belongs to
 * @param {connection} Reference to socket
 */

var Model = function (obj, collectionName, connection, onchange) {
  this.collection = collectionName;
  this.io = connection;

  var context = this;
  var prefix = '__bound';

  // Data binding listeners
  this.io.on('broadcast', function (eventType, data) {
    if (eventType === 'update') {
      data.forEach(function (model) {
        if (model._id === context._id) {
          console.log('Event "update": model', model._id, 'from', collectionName);
          for (var property in model) {
            context[prefix + property] = model[property];
          }
        }
      });
    }
    //data binding update trigger
    onchange();
  });

  for (var prop in obj) {
    bindProperty(prop, obj[prop], this);
  }
};

/**
 * Updates a single object
 *
 * @param {Object} Properties to be updated
 * @param {Function} Callback upon sucess/failure
 */

Model.prototype.update = function(set, callback) {
  this.io.emit(
    'updateOne',
    this.collection,
    this._id,
    set,
    this.handleResponse(function (data) {
      if (callback) callback(data);
    })
  );
};

/**
 * Deletes a single model
 */

Model.prototype.delete = function (callback) {
  this.io.emit(
    'deleteOne',
    this.collection,
    this._id,
    this.handleResponse(function (data) {
      if (callback) callback();
    })
  );
};

Model.prototype.handleResponse = function (callback) {
  return function (err, data) {
    if (err) {
      throw err;
    } else {
      if (callback) callback(data);
    }
  };
};
