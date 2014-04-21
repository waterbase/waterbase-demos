/*
 * Create connection to server through sockets
 *
 * @param {String} Url of server
 * @param {Object} Options for socket.io connection
 */

var Waterbase = function (url, options, onChange) {
  this.url = url || 'http://localhost';
  this.onChange = onChange || function(){};
  this.options = options || {
    // Default Options
    'force new connection': true
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
  return new Collection(collectionName, this.connection, callback, this.onChange);
};

/**
 * Class: Collection
 *
 * @param {String} name Collection name
 * @param {Connection} Reference to socket
 */

var Collection = function (name, connection, callback, onChange) {
  this.name = name;
  this.io = connection;
  this.onChange = onChange || function () {};

  this._storage = [];

  this.init(callback);
};

Collection.prototype.init = function(callback) {
  var collection = this;

  this.io.on('connect', function (socket) {
    if (callback) callback();

    // Retrieve all models on start
    collection.retrieveAll();
  });

  // Data Binding Listeners
  // Event: create
  this.io.on('create', function () {
    collection.handleBroadcast(function (data) {
      collection.retrieveOne(data[0]._id);
    }).apply(collection, arguments);
  });
  // Event: deleteAll
  this.io.on('deleteAll', function () {
    collection.handleBroadcast(function (data) {
      collection.retrieveAll();
    }).apply(collection, arguments);
  });
  // Event: deleteOne
  this.io.on('deleteOne', function () {
    collection.handleBroadcast(function (data) {
      collection._storage.forEach(function (model, index) {
        if (data[0]._id === model._id) {
          collection._storage.splice(index, 1);
        }
      });
    }).apply(collection, arguments);
  });
  // Event: Update
  this.io.on('update', function () {
    collection.handleBroadcast(function (data) {
      data.forEach(function (set) {
        collection._storage.forEach(function (model) {
          if (set && set._id === model._id) {
            model.set(set);
          }
        });
      });
    }).apply(collection, arguments);
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

Collection.prototype.retrieveAll = (function() {
  var running = false;
  var queued = false;

  return function (callback) {
    var collection = this;
    queued = true;
    if (!running) {
      queued = false;
      running = true;

      action(callback, collection);
    }
  };

  function action(callback, collection) {
    collection.io.emit(
      'retrieveAll',
      collection.name,
      collection.handleResponse(function (data) {
        collection._storage.length = 0;

        data.forEach(function (props, index) {
          collection._storage.push(new Model(props, collection.name, collection.io, collection.onChange));
        });

        collection.onChange();

        if (callback) callback(data);
        collection.onChange();
      })
    );

    setTimeout(function () {
        if (queued) {
          queued = false;
          action(callback, collection);
        } else {
          running = false;
        }
    }, 1000);
  }
})();

/**
 * Gets single document from collection
 *
 * @param {Object} obj Describe requrested document
 * @param {Function} callback Use response data
 */

Collection.prototype.retrieveOne = function(id, callback) {
  if (!id) throw 'first argument should be an model ID';

  var collection = this;

  this.io.emit(
    'retrieveOne',
    this.name,
    id,
    this.handleResponse(function (data) {
      var model = new Model(data, collection.name, collection.io, collection.onChange);
      collection._storage.push(model);

      if (callback) callback(model);
      collection.onChange();
    })
  );
};

/**
 * Create new document in collection
 *
 * @param {Function} callback to returned data
 */

Collection.prototype.create = function(set, callback) {
  if (!set) throw 'first argument should be an object';

  var collection = this;

  this.io.emit(
    'create',
    this.name,
    set,
    this.handleResponse(callback)
  );
};

Collection.prototype.update = function(where, set, callback) {
  if (!where || !set) throw 'first two arguments should be objects';

  var collection = this;

  this.io.emit(
    'update',
    this.name,
    where,
    set,
    this.handleResponse(callback)
  );
};

Collection.prototype.deleteAll = function(callback) {
  this.io.emit(
    'deleteAll',
    this.name,
    this.handleResponse(callback)
  );
};

Collection.prototype.handleResponse = function(callback) {
  var collection = this;
  return function (err, data) {
    if (err) {
      throw err;
    }
    if (callback) callback(data);
    collection.onChange();
  };
};

Collection.prototype.handleBroadcast = function(callback) {
  collection = this;

  return function (collectionName, data) {
    if (collection.name === collectionName) {
      callback(data);

      //data binding update trigger
      //collection.onChange();
    }
  };
};

var bindProperty = function (property, value, context, prefix) {

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

var Model = function (obj, collectionName, connection, onChange) {
  this.collection = collectionName;
  this.io = connection;
  this.onChange = onChange || function(){};

  var context = this;
  this.prefix = '__bound';

  for (var prop in obj) {
    bindProperty(prop, obj[prop], this, this.prefix);
  }
};

Model.prototype.set = function(set){
  for (var prop in set){
    this[this.prefix+prop] = set[prop];
  }
}

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
    this.handleResponse(callback)
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
    this.handleResponse(callback)
  );
};

Model.prototype.handleResponse = function (callback) {
  var model = this;
  return function (err, data) {
    if (err) {
      throw err;
    } else {
      if (callback) callback(data);
      model.onChange();
    }
  };
};