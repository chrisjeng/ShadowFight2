//NOTES:
// Ad developers can interact with the 'mraid' object
// Ad developers should not interact with the bridge objects

//This is loosely adapted from the reference sdk and other open-source sdks

//SETUP LOGGING MECHANISM
(function() {
  var is_ios = (/iphone|ipad|ipod/i).test(window.navigator.userAgent.toLowerCase());
  var is_android = false; //Todo, detect android as well

  if ( is_ios || is_android ) {
    //if we are running on a mobile device, let's send this into our actual device console log (i.e. NSLog)
    console = {};
    console.log = function(log) {
      var iframe = document.createElement('iframe');
      iframe.setAttribute('src', 'sdk-log: ' + log);

      //have to append the iframe to trigger the load
      document.documentElement.appendChild(iframe);

      //immediately remove it
      iframe.parentNode.removeChild(iframe);
      iframe = null;
    };
    console.debug = console.info = console.warn = console.error = console.log;
  }
}());

// ***********************************************************************************************************
// ***  DEFINE ADCOLONY BRIDGE  ******************************************************************************
// ***********************************************************************************************************
(function() {
  //SCOPED ADCOLONY BRIDGE INTERFACE

  // Establish the root adc_bridge object.
  var adc_bridge = window.adc_bridge = {};

  // Listeners for bridge events.
  var listeners = {};

  var features = {
    tel: false,
    sms: false,
    calendar: false,
    mail: false,  //mail is non-standard as of this time, and a custom extension of the adcolony sdk
    storePicture: false,
    inlineVideo: false
  };

  // Queue to track pending calls to the native SDK.
  var nativeCallQueue = adc_bridge.nativeCallQueue = [];

  // Whether a native call is currently in progress.
  adc_bridge.nativeCallInFlight = false;

  adc_bridge.setFeatures = function(properties) {
    features = properties;
  };

  adc_bridge.supports = function(feature){
    return features[feature];
  };

  adc_bridge.fireReadyEvent = function() {
    console.log("got ready event");
    adc_bridge.fireEvent('ready');
  };

  adc_bridge.fireChangeEvent = function(properties) {
    adc_bridge.fireEvent('change', properties);
  };

  adc_bridge.fireErrorEvent = function(message, action) {
    adc_bridge.fireEvent('error', message, action);
  };

  adc_bridge.fireAppPresenceEvent = function(handle, status) {
    adc_bridge.fireEvent('appPresence', handle, status);
  };

  adc_bridge.fireSocialPresenceEvent = function(service, status) {
    adc_bridge.fireEvent('socialPresence', service, status);
  };

  adc_bridge.fireEvent = function(type) {
    var ls = listeners[type];
    if (ls) {
      var args = Array.prototype.slice.call(arguments);
      args.shift();
      var l = ls.length;
      for (var i = 0; i < l; i++) {
        ls[i].apply(null, args);
      }
    }
  };

  adc_bridge.nativeCallComplete = function(command) {
    if (nativeCallQueue.length === 0)
    {
      adc_bridge.nativeCallInFlight = false;
      return;
    }

    var nextCall = nativeCallQueue.pop();
    window.location = nextCall;
  };

  adc_bridge.executeNativeCall = function(command) {
    var call = 'mraid://' + command;

    var key, value;
    var isFirstArgument = true;

    for (var i = 1; i < arguments.length; i += 2) {
      key = arguments[i];
      value = arguments[i + 1];

      if (value === null) continue;

      if (isFirstArgument) {
        call += '?';
        isFirstArgument = false;
      } else {
        call += '&';
      }

      call += key + '=' + encodeURIComponent(value);
    }

    if (adc_bridge.nativeCallInFlight)
    {
      adc_bridge.nativeCallInFlight = true;
      nativeCallQueue.push(call);
    } else {
      adc_bridge.nativeCallInFlight = true;
      window.location = call;
    }
  };

  // HACK: Android 2.0.[0-3] don't properly decode url-encoded stuff, so we
  // attempt to remove any characters that WOULD be url-encoded from the
  // command string before sending it over.
  adc_bridge.executeHackedAndroidNativeCall = function(command) {
    var call = 'mraid://' + command;

    var key, value;
    var isFirstArgument = true;

    for (var i = 1; i < arguments.length; i += 2) {
      key = arguments[i];
      value = arguments[i + 1];

      if (value === null) continue;

      if (isFirstArgument) {
        call += '?';
        isFirstArgument = false;
      } else {
        call += '&';
      }

      // BEGIN CHANGED CODE
      if (/^[{\[].*[}\]]$/.test(value)) {
        // if `value` starts and ends with {} or [], we assume it's
        // stringified JSON and strip any double-quotes (which would be URL-
        // encoded, and so break Android)
        value = value.replace(/["]/g, '');
      }
      // then, we take care to NOT url encode anything before sending it off
      call += key + '=' + value;
      // END CHANGED CODE
    }

    if (adc_bridge.nativeCallInFlight)
    {
      adc_bridge.nativeCallInFlight = true;
      nativeCallQueue.push(call);
    } else {
      adc_bridge.nativeCallInFlight = true;
      window.location = call;
    }
  };

  adc_bridge.addEventListener = function(event, listener) {
    var eventListeners;
    listeners[event] = listeners[event] || [];
    eventListeners = listeners[event];

    for (var l in eventListeners) {
      // Listener already registered, so no need to add it.
      if (listener === l) return;
    }

    eventListeners.push(listener);
  };

  adc_bridge.removeEventListener = function(event, listener) {
    if (listeners.hasOwnProperty(event)) {
      var eventListeners = listeners[event];
      if (eventListeners) {
        var idx = eventListeners.indexOf(listener);
        if (idx !== -1) {
          eventListeners.splice(idx, 1);
        }
      }
    }
  };
}());

// ***********************************************************************************************************
// ***  DEFINE MRAID API  ************************************************************************************
// ***********************************************************************************************************
(function() {
  //SCOPED STANDARD MRAID INTERFACE

  var mraid = window.mraid = {};
  var bridge = window.adc_bridge;  //This talks to the SDK.

  bridge.adc_version = '0.0';

  bridge.os_version = '0.0';

  bridge.os_name = '';

  // *********************  CONSTANTS  ************************

  var VERSION = mraid.VERSION = '1.0';

  var STATES = mraid.STATES = {
    LOADING: 'loading',     // Initial state.
    DEFAULT: 'default',
    EXPANDED: 'expanded',
    HIDDEN: 'hidden'
  };

  var EVENTS = mraid.EVENTS = {
    ERROR: 'error',
    INFO: 'info',
    READY: 'ready',
    STATECHANGE: 'stateChange',
    VIEWABLECHANGE: 'viewableChange',
    SIZECHANGE: 'sizeChange',
    //custom extensions below
    APP_PRESENCE: 'appPresence',
    SOCIAL_PRESENCE: 'socialPresence'
  };

  var ADC_EVENTS = mraid.ADC_EVENTS = {
    INFO: 'info',
    DOWNLOAD: 'download',
    CONTINUE: 'continue',
  };

  var PLACEMENT_TYPES = mraid.PLACEMENT_TYPES = {
    UNKNOWN: 'unknown',
    INLINE: 'inline',
    INTERSTITIAL: 'interstitial'
  };

  // External MRAID state: may be directly or indirectly modified by the ad JS.

  // Properties which define the behavior of an expandable ad.
  var expandProperties = {
    width: -1,
    height: -1,
    useCustomClose: false,
    isModal: true,
    lockOrientation: false
  };

  var hasSetCustomSize = false;

  var hasSetCustomClose = false;

  var listeners = {};

  // Internal MRAID state. Modified by the native SDK. /////////////////////////////////////////////

  var state = STATES.LOADING;

  var isViewable = false;

  var screenSize = { width: -1, height: -1 };

  var placementType = PLACEMENT_TYPES.INTERSTITIAL;  //always interstitial for now

  //////////////////////////////////////////////////////////////////////////////////////////////////

  var EventListeners = function(event) {
    this.event = event;
    this.count = 0;
    var listeners = {};

    this.add = function(func) {
      var id = String(func);
      if (!listeners[id]) {
        listeners[id] = func;
        this.count++;
      }
    };

    this.remove = function(func) {
      var id = String(func);
      if (listeners[id]) {
        listeners[id] = null;
        delete listeners[id];
        this.count--;
        return true;
      } else {
        return false;
      }
    };

    this.removeAll = function() {
      for (var id in listeners) {
        if (listeners.hasOwnProperty(id)) this.remove(listeners[id]);
      }
    };

    this.broadcast = function(args) {
      for (var id in listeners) {
        if (listeners.hasOwnProperty(id)) listeners[id].apply({}, args);
      }
    };

    this.toString = function() {
      var out = [event, ':'];
      for (var id in listeners) {
        if (listeners.hasOwnProperty(id)) out.push('|', id, '|');
      }
      return out.join('');
    };
  };

  var broadcastEvent = function() {
    var args = new Array(arguments.length);
    var l = arguments.length;
    for (var i = 0; i < l; i++) args[i] = arguments[i];
    var event = args.shift();
    if (listeners[event]) listeners[event].broadcast(args);
  };

  var contains = function(value, array) {
    for (var i in array) {
      if (array[i] === value) return true;
    }
    return false;
  };

  var clone = function(obj) {
    if (obj === null) return null;
    var f = function() {};
    f.prototype = obj;
    return new f();
  };

  var stringify = function(obj) {
    if (typeof obj === 'object') {
      var p,
          out = [];

      if (obj.push) {
        // Array.
        for (p in obj) out.push(obj[p]);
        return '[' + out.join(',') + ']';
      } else {
        // Other object.
        for (p in obj) out.push("'" + p + "': " + obj[p]);
        return '{' + out.join(',') + '}';
      }
    } else return String(obj);
  };

  var trim = function(str) {
    return str.replace(/^\s+|\s+$/g, '');
  };

  // Functions that will be invoked by the native SDK whenever a "change" event occurs.
  var changeHandlers = {
    state: function(val) {
      console.log("Changing mraid state to "+val);
      if (state === STATES.LOADING) {
        broadcastEvent(EVENTS.INFO, 'Native SDK initialized.');
      }
      state = val;
      broadcastEvent(EVENTS.INFO, 'Set state to ' + stringify(val));
      broadcastEvent(EVENTS.STATECHANGE, state);
    },

    viewable: function(val) {
      console.log("Changing mraid viewable to "+val);
      isViewable = val;
      broadcastEvent(EVENTS.INFO, 'Set isViewable to ' + stringify(val));
      broadcastEvent(EVENTS.VIEWABLECHANGE, isViewable);
    },

    placementType: function(val) {
      console.log("Changing mraid placementType to "+val);
      placementType = val;
      broadcastEvent(EVENTS.INFO, 'Set placementType to ' + stringify(val));
    },

    screenSize: function(val) {
      for (var key in val) {
        if (val.hasOwnProperty(key)){
          screenSize[key] = val[key];
          console.log("screen "+key+" is now "+val[key]);
        }
      }

      if (!hasSetCustomSize) {
        expandProperties['width'] = screenSize['width'];
        expandProperties['height'] = screenSize['height'];
      }
      broadcastEvent(EVENTS.INFO, 'Set screenSize to ' + stringify(val));
    },

    sizeChange: function(val) {
      //this is mraid 2.0
      broadcastEvent(EVENTS.SIZECHANGE, val['width'],val['height']);
    },

    expandProperties: function(val) {
      console.log("Changing mraid expandProperties to "+val);
      for (var key in val) {
        if (val.hasOwnProperty(key)) expandProperties[key] = val[key];
      }
      broadcastEvent(EVENTS.INFO, 'Merging expandProperties with ' + stringify(val));
    }
  };

  var validate = function(obj, validators, action, merge) {
    if (!merge) {
      // Check to see if any required properties are missing.
      if (obj === null) {
        broadcastEvent(EVENTS.ERROR, 'Required object not provided.', action);
        return false;
      } else {
        for (var i in validators) {
          if (validators.hasOwnProperty(i) && obj[i] === undefined) {
            broadcastEvent(EVENTS.ERROR, 'Object is missing required property: ' + i + '.', action);
            return false;
          }
        }
      }
    }

    for (var prop in obj) {
      var validator = validators[prop];
      var value = obj[prop];
      if (validator && !validator(value)) {
        // Failed validation.
        broadcastEvent(EVENTS.ERROR, 'Value of property ' + prop + ' is invalid.',
          action);
        return false;
      }
    }
    return true;
  };

  var expandPropertyValidators = {
    width: function(v) { return !isNaN(v) && v >= 0; },
    height: function(v) { return !isNaN(v) && v >= 0; },
    useCustomClose: function(v) { return (typeof v === 'boolean'); },
    lockOrientation: function(v) { return (typeof v === 'boolean'); }
  };

  bridge.addEventListener('change', function(properties) {
    for (var p in properties) {
      if (properties.hasOwnProperty(p)) {
        var handler = changeHandlers[p];
        handler(properties[p]);
      }
    }
  });

  bridge.addEventListener('error', function(message, action) {
    broadcastEvent(EVENTS.ERROR, message, action);
  });

  bridge.addEventListener('ready', function() {
    broadcastEvent(EVENTS.READY);
  });

  //custom extension
  bridge.addEventListener('appPresence', function(handle, status) {
    broadcastEvent(EVENTS.APP_PRESENCE, handle, status);
  });

  bridge.addEventListener('socialPresence', function(service, status) {
    broadcastEvent(EVENTS.SOCIAL_PRESENCE, service, status);
  });

  mraid.addEventListener = function(event, listener) {
    if (!event || !listener) {
      broadcastEvent(EVENTS.ERROR, 'Both event and listener are required.', 'addEventListener');
    } else if (!contains(event, EVENTS)) {
      broadcastEvent(EVENTS.ERROR, 'Unknown MRAID event: ' + event, 'addEventListener');
    } else {
      if (!listeners[event]) listeners[event] = new EventListeners(event);
      listeners[event].add(listener);
    }
  };

  mraid.close = function() {
    if (state === STATES.HIDDEN) {
      broadcastEvent(EVENTS.ERROR, 'Ad cannot be closed when it is already hidden.',
        'close');
    } else bridge.executeNativeCall('close');
  };


  mraid.expand = function(URL) {
    console.log("mraid.expand called");
    if (state !== STATES.DEFAULT) {
      console.log("Can not expand, because state is not in the default state");
      broadcastEvent(EVENTS.ERROR, 'Ad can only be expanded from the default state.', 'expand');
    } else {
      var args = ['expand'];

      if (hasSetCustomClose) {
        args = args.concat(['shouldUseCustomClose', expandProperties.useCustomClose ? 'true' : 'false']);
      }

      if (hasSetCustomSize) {
        if (expandProperties.width >= 0 && expandProperties.height >= 0) {
          args = args.concat(['w', expandProperties.width, 'h', expandProperties.height]);
        }
      }

      if (typeof expandProperties.lockOrientation !== 'undefined') {
        args = args.concat(['lockOrientation', expandProperties.lockOrientation]);
      }

      if (URL) {
        args = args.concat(['url', URL]);
      }

      bridge.executeNativeCall.apply(this, args);
    }
  };

  mraid.getExpandProperties = function() {
    var properties = {
      width: expandProperties.width,
      height: expandProperties.height,
      useCustomClose: expandProperties.useCustomClose,
      isModal: expandProperties.isModal
    };
    return properties;
  };

  mraid.getPlacementType = function() {
    return placementType;
  };

  mraid.getState = function() {
    return state;
  };


  mraid.getVersion = function() {
    return mraid.VERSION;
  };

  mraid.isViewable = function() {
    return isViewable;
  };

  mraid.open = function(URL) {
    if (!URL) broadcastEvent(EVENTS.ERROR, 'URL is required.', 'open');
    else bridge.executeNativeCall('open', 'url', URL);
  };

  mraid.removeEventListener = function(event, listener) {
    if (!event) broadcastEvent(EVENTS.ERROR, 'Event is required.', 'removeEventListener');
    else {
      if (listener && (!listeners[event] || !listeners[event].remove(listener))) {
        broadcastEvent(EVENTS.ERROR, 'Listener not currently registered for event.',
          'removeEventListener');
        return;
      } else if (listeners[event]) listeners[event].removeAll();

      if (listeners[event] && listeners[event].count === 0) {
        listeners[event] = null;
        delete listeners[event];
      }
    }
  };

  mraid.setExpandProperties = function(properties) {
    if (validate(properties, expandPropertyValidators, 'setExpandProperties', true)) {
      if (properties.hasOwnProperty('width') || properties.hasOwnProperty('height')) {
        hasSetCustomSize = true;
      }

      if (properties.hasOwnProperty('useCustomClose')) hasSetCustomClose = true;

      var desiredProperties = ['width', 'height', 'useCustomClose', 'lockOrientation'];
      var length = desiredProperties.length;
      for (var i = 0; i < length; i++) {
        var propname = desiredProperties[i];
        if (properties.hasOwnProperty(propname)) expandProperties[propname] = properties[propname];
      }
    }
  };

  //AdColony doesn't respect this.  AdColony uses it's own custom close button to go with the theme of the SDK.
  mraid.useCustomClose = function(shouldUseCustomClose) {
    expandProperties.useCustomClose = shouldUseCustomClose;
    hasSetCustomClose = true;
    bridge.executeNativeCall('usecustomclose', 'shouldUseCustomClose', shouldUseCustomClose);
  };

  // ********************** MRAID 2.0 API ***************************************
  mraid.getMaxSize = mraid.getScreenSize = function(){
    return screenSize;
  };

  mraid.getDefaultPosition = function(){
    return {x:0, y:0, width: screenSize['width'], height: screenSize['height']};
  };

  mraid.supports = function(feature){
    return bridge.supports(feature);
  };

  //mraid.createCalendarEvent({description: 'Mayan Apocalypse/End of World', location: 'everywhere', start: '2012-12-21T00:00-05:00', end: '2012-12- 22T00:00-05:00'})
  //Uses W3C standards
  mraid.createCalendarEvent = function(properties){
    var args = ['create_calendar_event'];
    for (var key in properties) {
      if(key == 'recurrence') {
        args = args.concat([key, JSON.stringify(properties[key])]);
      } else {
        args = args.concat([key, properties[key]]);
      }
    }
    bridge.executeNativeCall.apply(this, args);
  };


  // ****************************************************************************
  // ********************** NON STANDARD MRAID EXTENSIONS ***********************
  // ****************************************************************************

  //call to send info, download, and continue clicks through the standard adcolony channel
  //WARNING: NON-STANDARD API
        mraid.sendADCEvent = function( params, category, name )
        {
          if (!category) category = "misc";
          if (!params) params = {"category":category};

          if (params.category || name)
          {
            params.category = params.category || category;
            if (name) params.name = params.name || name;
            mraid.sendADCCustomEvent( JSON.stringify(params) );   // URLEncode?
          }
          else
          {
            console.log("mraid.sendADCEvent called");
            var args = ['send_adc_event'];
            args = args.concat(['type', params]);

            bridge.executeNativeCall.apply(this, args);
          }
  };

     //call to check if a social network can be used
     //WARNING:  NON-STANDARD API
     //mraid.checkSocialPresence(mraid.ADC_SOCIAL_SERVICES.FACEBOOK)
     //you must register a callback function that will receive the result
     mraid.checkSocialPresence = function(service) {
        console.log("mraid.checkSocialPresence called");
        var args = ['check_social_presence'];
        args = args.concat(['service', service]);
        bridge.executeNativeCall.apply(this, args);
     };

    //call to compose a social post
    //WARNING: NON-STANDARD API
    mraid.socialPost = function(service, text, url) {
        console.log("mraid.socialPost called");
        var args = ['social_post'];
        args = args.concat(['service', service]);
        args = args.concat(['text', text]);
        args = args.concat(['url', url]);

        bridge.executeNativeCall.apply(this, args);
    };

    var ADC_SOCIAL_SERVICES = mraid.ADC_SOCIAL_SERVICES = {
        FACEBOOK: 'facebook',
        TWITTER: 'twitter',
        SINA_WEIBO: 'sina weibo',
    };

  //call to send special event types i.e. 'option_1'
  //WARNING: NON-STANDARD API
  mraid.sendADCCustomEvent = function(event_type) {
    console.log("mraid.sendADCCustomEvent called");
    var args = ['custom_event'];

    // HACK: Android 2.0.[0-3] don't convert events to JSON objects
    // before sending them over, so we do it here, and then call a "special"
    // version of executeNativeCall to send them over.
    // BEGIN NEW CODE
    if (bridge.os_name=='android' && /2\.0\.[0-3]/.test(bridge.adc_version)) {
      event_type = JSON.stringify({'event_type': event_type});
      args = args.concat(['event_type', event_type]);
      bridge.executeHackedAndroidNativeCall.apply(this, args);
    } else {
    // END NEW CODE
      args = args.concat(['event_type', event_type]);
      bridge.executeNativeCall.apply(this, args);
    // ALSO I GUESS TECHNICALLY THIS BRACE IS NEW CODE
    }
    // END BRACE
  };

  /**
   * Formats iTunes store URLs so they work properly with the iOS SDK. Does
   * nothing to non-iTunes URLs.
   * @param  {string} url The url to format
   * @return {string}     The formatted (iTunes) or unformatted (non-iTunes)
   *                      URL.
   */
  var formatStoreUrl = function (url) {
    if (url.match(new RegExp('http[s]?://[^/]*(?:itunes|apple|appstore).com/'))) {
      var info = url.match(new RegExp('http[s]?://[^/]*(?:itunes|apple|appstore).com/(?:.*/)?(audiobook|book|app|movie|album|music-video|podcast|tv-season)/.*id=?([\\d]+)'));

      if (info) {
        var type = info[1];
        var id = info[2];

        return 'https://itunes.apple.com/' + type + '?id=' + id;
      } else {
        console.log('[mraid] unable to parse ID and type from iTunes URL ' + url);
      }
    }

    return url;
  };

  //call to open the itunes store or android market for the specific item url or bundle id
  //WARNING:  NON-STANDARD API
  //iOS - item should be the full itunes url
  //Android -item should be the bundle id
  mraid.openStore = function(item) {
    console.log("mraid.openStore called");
    var args = ['open_store'];

    args = args.concat(['item', formatStoreUrl(item)]);

    bridge.executeNativeCall.apply(this, args);
  };

    //call to check if an app is installed
    //WARNING:  NON-STANDARD API
    //mraid.checkAppPresence('fb://')
    //you must register a callback function that will receive the result
    mraid.checkAppPresence = function(handle) {
        console.log("mraid.checkAppPresence called");
        var args = ['check_app_presence'];
        args = args.concat(['handle', handle]);

        bridge.executeNativeCall.apply(this, args);
    };



  //call to launch an app directly
  //WARNING:  NON-STANDARD API
  //iOS - handle should be the app's registered URL scheme
  //Android - handle should be the bundle id
    //mraid.launchApp('yelp:')
  mraid.launchApp = function(handle) {
    console.log("mraid.launchApp called");
    var args = ['launch_app'];
    args = args.concat(['handle', handle]);

    bridge.executeNativeCall.apply(this, args);
  };

  //call to get the adcolony sdk version.
  //WARNING: NON-STANDARD API
  mraid.getSDKVersion = function() {
    return bridge.adc_version;
  };

  //call to get the host operating system version
  //WARNING: NON-STANDARD API
  mraid.getOSVersion = function() {
    return bridge.os_version;
  };

  //call to get the host operating system name.
  //WARNING: NON-STANDARD API
  mraid.getOSName = function() {
    return bridge.os_name;
  };

  //mraid.sendSMS({to:"5558675304", body:"I'll see you at the ballgame."})
  //WARNING:  NON-STANDARD API
  mraid.sendSMS = function(properties){
    var args = ['sms'];
    for (var key in properties) {
      args = args.concat([key, properties[key]]);
    }
    bridge.executeNativeCall.apply(this, args);
  };

  //mraid.sendMail({to:"steve@apple.com", subject:"The iPhone 5" body:"That is a pretty big phone.", html:false})
  //WARNING:  NON-STANDARD API
  mraid.sendMail = function(properties){
    var args = ['mail'];
    for (var key in properties) {
      args = args.concat([key, properties[key]]);
    }
    bridge.executeNativeCall.apply(this, args);
  };

  //mraid.placeCall("5558675304")
  //WARNING:  NON-STANDARD API
  mraid.placeCall = function(number){
    var args = ['tel'];
    args = args.concat(['number', number]);
    bridge.executeNativeCall.apply(this, args);
  };

    //mraid.autoPlay();
    //WARNING:  NON-STANDARD API
    //Triggers youtube auto playback.
    mraid.autoPlay = function(){
        var args = ['auto_play'];
        bridge.executeNativeCall.apply(this, args);
    };

  // call to make an in-app purchase
  // WARNING:  NON-STANDARD API
  // mraid.makeInAppPurchase("example.product.id", 1)
  // ad must be configured on the dashboard with any product ids used with this method
  mraid.makeInAppPurchase = function(product, quantity) {
    console.log("mraid.makeInAppPurchase called");
    var args = ['make_in_app_purchase'];
    args = args.concat(['product', product]);
    args = args.concat(['quantity', quantity]);
    bridge.executeNativeCall.apply(this, args);
  };

  // call to vibrate the device (does nothing on devices without vibrators)
  // WARNING:  NON-STANDARD API
  // mraid.vibrate();
  mraid.vibrate = function() {
    console.log("mraid.vibrate called");
    var args = ['vibrate'];
    bridge.executeNativeCall.apply(this, args);
  };

   // call to save a screenshot of the current webview content to the photo gallery
   // WARNING:  NON-STANDARD API
   // mraid.saveScreenshot();
   mraid.saveScreenshot = function() {
     console.log("mraid.saveScreenshot called");
     var args = ['save_screenshot'];
     bridge.executeNativeCall.apply(this, args);
  };


    //-------------------------------------------------------------------------
    // Event Macro System
    //-------------------------------------------------------------------------

    // PAGE EVENTS
    mraid.sendADCEventPageShow = function( params ) { mraid.sendADCEvent( params, "page", "show" ); };
    mraid.sendADCEventPageClose = function( params ) { mraid.sendADCEvent( params, "page", "close" ); };
    mraid.sendADCEventPage = function( params ) { mraid.sendADCEvent( params, "page" ); };

    // CLICK EVENTS
    mraid.sendADCEventClickWeb = function( params ) { mraid.sendADCEvent( params, "click", "web" ); };
    mraid.sendADCEventClickDownload = function( params ) { mraid.sendADCEvent( params, "click", "download" ); };
    mraid.sendADCEventClickMaps = function( params ) { mraid.sendADCEvent( params, "click", "maps" ); };
    mraid.sendADCEventClickCalendar = function( params ) { mraid.sendADCEvent( params, "click", "calendar" ); };
    mraid.sendADCEventClickYouTube = function( params ) { mraid.sendADCEvent( params, "click", "youtube" ); };
    mraid.sendADCEventClickTwitter = function( params ) { mraid.sendADCEvent( params, "click", "twitter" ); };
    mraid.sendADCEventClickFacebook = function( params ) { mraid.sendADCEvent( params, "click", "facebook" ); };
    mraid.sendADCEventClickShowtimes = function( params ) { mraid.sendADCEvent( params, "click", "showtimes" ); };
    mraid.sendADCEventClickSearch = function( params ) { mraid.sendADCEvent( params, "click", "search" ); };
    mraid.sendADCEventClick = function( params ) { mraid.sendADCEvent( params, "click" ); };

    // SOCIAL EVENTS
    mraid.sendADCEventSocialTwitter = function( params ) { mraid.sendADCEvent( params, "social", "twitter" ); };
    mraid.sendADCEventSocialFacebook = function( params ) { mraid.sendADCEvent( params, "social", "facebook" ); };
    mraid.sendADCEventSocialYouTube = function( params ) { mraid.sendADCEvent( params, "social", "youtube" ); };
    mraid.sendADCEventSocialPinterest = function( params ) { mraid.sendADCEvent( params, "social", "pinterest" ); };
    mraid.sendADCEventSocialInstagram = function( params ) { mraid.sendADCEvent( params, "social", "instagram" ); };
    mraid.sendADCEventSocialGooglePlus = function( params ) { mraid.sendADCEvent( params, "social", "googleplus" ); };
    mraid.sendADCEventSocialTumblr = function( params ) { mraid.sendADCEvent( params, "social", "tumblr" ); };
    mraid.sendADCEventSocialRSS = function( params ) { mraid.sendADCEvent( params, "social", "rss" ); };
    mraid.sendADCEventSocial = function( params ) { mraid.sendADCEvent( params, "social" ); };

    // MEDIA EVENTS
    mraid.sendADCEventMediaVideo = function( params ) { mraid.sendADCEvent( params, "media", "video" ); };
    mraid.sendADCEventMediaPhoto = function( params ) { mraid.sendADCEvent( params, "media", "photo" ); };


    // INTERACTION EVENTS
    mraid.sendADCEventGallerySwipe = function( params ) { mraid.sendADCEvent( params, "gallery", "swipe" ); };
    mraid.sendADCEventFrameScroll = function( params ) { mraid.sendADCEvent( params, "frame", "scroll" ); };
    mraid.sendADCEventDeviceMotionShake = function( params ) { mraid.sendADCEvent( params, "motion", "shake" ); };
    mraid.sendADCEventDeviceMotionTilt = function( params ) { mraid.sendADCEvent( params, "motion", "tilt" ); };
    mraid.sendADCEventDeviceMotionRotate = function( params ) { mraid.sendADCEvent( params, "motion", "rotate" ); };
    mraid.sendADCEventTouchSwipe = function( params ) { mraid.sendADCEvent( params, "touch", "swipe" ); };
    mraid.sendADCEventTouchFlick = function( params ) { mraid.sendADCEvent( params, "touch", "flick" ); };
    mraid.sendADCEventTouchDragDrop = function( params ) { mraid.sendADCEvent( params, "touch", "dragdrop" ); };
    mraid.sendADCEventTouchMultiTouch = function( params ) { mraid.sendADCEvent( params, "touch", "multitouch" ); };
    mraid.sendADCEventTouchPinch = function( params ) { mraid.sendADCEvent( params, "touch", "pinch" ); };
    mraid.sendADCEventTouchWipeAway = function( params ) { mraid.sendADCEvent( params, "touch", "wipeaway" ); };
    mraid.sendADCEventTouchDraw = function( params ) { mraid.sendADCEvent( params, "touch", "draw" ); };

}());

var ADC_DEVICE_INFO = window.ADC_DEVICE_INFO = {"app_id":"a3d3d00631dbf5ff215272870ff3f294c0cf0969","odin1":"","mac_sha1":"","os_name":"ios","os_version":"8.1","network_type":"none","device_model":"ipod5,1","device_type":"media_player","sdk_version":"2.4.12","advertiser_id":"0220BD46-24FC-48C6-B505-1F297AA70EA0","ln":"en","country":"US","zip":"92626","dma":"803","sha1_android_id":"","sha1_imei":"","zone_type":"interstitial","pub_id":"5313790b61a5c4778045a4286c6b87a8a1243e1f","ip_address":"98.148.81.161"};
if (typeof Object.freeze == 'function') Object.freeze(ADC_DEVICE_INFO);
