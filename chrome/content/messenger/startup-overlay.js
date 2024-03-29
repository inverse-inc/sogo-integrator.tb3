/* -*- Mode: java; tab-width: 2; c-tab-always-indent: t; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

function jsInclude(files, target) {
    let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                 .getService(Components.interfaces.mozIJSSubScriptLoader);
    for (let i = 0; i < files.length; i++) {
        try {
            loader.loadSubScript(files[i], target);
        }
        catch(e) {
            dump("startup-overlay.js: failed to include '" + files[i] + "'\n" + e + "\n");
        }
    }
}

let forcedPrefs = {};

let iCc = Components.classes;
let iCi = Components.interfaces;
let thunderbirdUID = "{3550f703-e582-4d05-9a08-453d09bdfdc6}";

function checkExtensionsUpdate() {
    let extensions = getHandledExtensions();
    dump("number of handled extensions: " + extensions.length + "\n");
    let results = prepareRequiredExtensions(extensions);
    if (results["urls"].length + results["uninstall"].length > 0) {
        window.openDialog("chrome://sogo-integrator/content/messenger/update-dialog.xul",
                          "Extensions", "status=yes", results);
    } else {
        dump("  no available update for handled extensions\n");
        jsInclude(["chrome://sogo-integrator/content/messenger/folders-update.js"]);
        checkFolders();
    }
}

function getHandledExtensions() {
    let handledExtensions = [];

    let rdf = iCc["@mozilla.org/rdf/rdf-service;1"].getService(iCi.nsIRDFService);
    let extensions = rdf.GetResource("http://inverse.ca/sogo-integrator/extensions");
    let updateURL = rdf.GetResource("http://inverse.ca/sogo-integrator/updateURL");
    let extensionId = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#id");
    let extensionName = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#name");

    let ds = rdf.GetDataSourceBlocking("chrome://sogo-integrator/content/extensions.rdf");

    try {
        let urlNode = ds.GetTarget(extensions, updateURL, true);
        if (urlNode instanceof iCi.nsIRDFLiteral)
            handledExtensions.updateRDF = urlNode.Value;

        let targets = ds.ArcLabelsOut(extensions);
        while (targets.hasMoreElements()) {
            let predicate = targets.getNext();
            if (predicate instanceof iCi.nsIRDFResource) {
                let target = ds.GetTarget(extensions, predicate, true);
                if (target instanceof iCi.nsIRDFResource) {
                    let extension = {};
                    let id = ds.GetTarget(target, extensionId, true);
                    if (id instanceof iCi.nsIRDFLiteral)
                        extension.id = id.Value;
                    let name = ds.GetTarget(target, extensionName, true);
                    if (name instanceof iCi.nsIRDFLiteral) {
                        extension.name = name.Value;
                        // 						dump("name: " + extension.name + "\n");
                    }
                    if (extension.id)
                        handledExtensions.push(extension);
                }
            }
        }
    }
    catch(e) {}

    return handledExtensions;
}

function prepareRequiredExtensions(extensions) {
    let extensionsURL = [];
    let unconfiguredExtensions = [];
    let uninstallExtensions = [];

    let gExtensionManager = iCc["@mozilla.org/extensions/manager;1"]
                            .getService(iCi.nsIExtensionManager);
    let preferences = Components.classes["@mozilla.org/preferences;1"]
                      .getService(Components.interfaces.nsIPref);
    let appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
                  .getService(Components.interfaces.nsIXULRuntime);

    let rdf = iCc["@mozilla.org/rdf/rdf-service;1"]
              .getService(iCi.nsIRDFService);

    for (let i = 0; i < extensions.length; i++) {
        let extensionItem = gExtensionManager.getItemForID(extensions[i].id);
        let extensionRDFURL = extensions.updateRDF
                              .replace("%ITEM_ID%", escape(extensions[i].id), "g")
                              .replace("%ITEM_VERSION%", "0.00", "g")
                              .replace("%PLATFORM%", escape(appInfo.OS + "_" + appInfo.XPCOMABI), "g");
        let extensionURN = rdf.GetResource("urn:mozilla:extension:"
                                           + extensions[i].id);
        let extensionData = getExtensionData(rdf,
                                             extensionRDFURL, extensionURN);
        if (extensionData) {
            // We check if we have to disable some extension that _is installed_
            // If so, let's do it right away
            if (extensionItem && extensionItem.name.length > 0
                && extensionData.version == "disabled") {
                uninstallExtensions.push(extensions[i].id);
            }
            else if ((!extensionItem || !extensionItem.name
                      || extensionData.version != extensionItem.version)
                     && extensionData.version != "disabled") {
                extensionsURL.push({name: extensions[i].name,
                            url: extensionData.url});
            }
            else {
                let configured = false;
                try {
                    configured = preferences.GetBoolPref("inverse-sogo-integrator.extensions." + extensions[i].id + ".isconfigured");
                }
                catch(e) {}
                if (!configured)
                    unconfiguredExtensions.push(extensions[i].id);
            }
        }
        else
            dump("no data returned for '" + extensions[i].id + "'\n");
    }

    return {urls: extensionsURL,
            configuration: unconfiguredExtensions,
            uninstall: uninstallExtensions};
}

function getExtensionData(rdf, extensionRDFURL, extensionURN) {
    let extensionData = null;
    let updates = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#updates");

    try {
        dump("url: " + extensionRDFURL + "\n");
        let ds = rdf.GetDataSourceBlocking(extensionRDFURL);
        let urlNode = ds.GetTarget(extensionURN, updates, true);
        if (urlNode instanceof iCi.nsIRDFResource) {
            let targets = ds.ArcLabelsOut(urlNode);
            while (targets.hasMoreElements()) {
                let node = targets.getNext();
                if (node instanceof iCi.nsIRDFResource) {
                    let nodeValue = ds.GetTarget(urlNode, node, true);
                    if (nodeValue instanceof iCi.nsIRDFResource)
                        extensionData = GetRDFUpdateData(rdf, ds, nodeValue);
                }
            }
        }
    }
    catch (e) {
        dump("getExtensionData: " + e + "\n");
    }

    return extensionData;
}

function GetRDFUpdateData(rdf, ds, node) {
    // 	dump("getrdfupdatedata...\n");
    let updateData = { url: null, version: null };

    let extensionVersion = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#version");
    let targetApplication = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#targetApplication");
    let applicationId = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#id");
    let updateLink = rdf.GetResource("http://www.mozilla.org/2004/em-rdf#updateLink");

    let version = ds.GetTarget(node, extensionVersion, true);
    if (version instanceof iCi.nsIRDFLiteral) {
        updateData.version = version.Value;
        let appNode = ds.GetTarget(node, targetApplication, true);
        if (appNode) {
            let appId = ds.GetTarget(appNode, applicationId, true);
            if (appId instanceof iCi.nsIRDFLiteral
                && appId.Value == thunderbirdUID) {
                let updLink = ds.GetTarget(appNode, updateLink, true);
                if (updLink instanceof iCi.nsIRDFLiteral)
                    updateData.url = updLink.Value;
            }
        }
    }

    if (!(updateData.url && updateData.version))
        updateData = null;

    return updateData;
}

function sogoIntegratorStartupOverlayOnLoad() {
    let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                 .getService(Components.interfaces.mozIJSSubScriptLoader);
    try {
        loader.loadSubScript("chrome://sogo-integrator/content/general/custom-preferences.js");
        applyForcedPrefs();
    }
    catch(e) {
        dump("Custom preference code not available.\ne: " + e + "\n");
    }

    try {
        loader.loadSubScript("chrome://sogo-integrator/content/general/startup.js");
        try {
            CustomStartup();
        }
        catch(customE) {
            dump("An exception occured during execution of custom startup"
                 + " code.\nException: " + customE
                 + "\nFile: " + customE.fileName
                 + "\nLine: " + customE.lineNumber
                 + "\n\n Stack:\n\n" + customE.stack);
        }
        dump("Custom startup code executed\n");
    }
    catch(e) {
        dump("Custom startup code not available.\ne: " + e + "\n");
    }

    if (typeof(getCompositeCalendar) == "undefined"
        || !_setupCalStartupObserver()) {
        dump("no calendar available: checking extensions update right now.\n");
        checkExtensionsUpdate();
    }
}

//
// Work-around a bug in the SSL code which seems to hang Thunderbird when
// calendars are refreshing and extensions updates are being checked...
//
function _setupCalStartupObserver() {
	let handled = false;

	let compCalendar = getCompositeCalendar();
	let calDavCount = 0;
	let calendars = compCalendar.getCalendars({});
	for each (let calendar in calendars) {
      if (calendar.type == "caldav"
          && calendar.readOnly
          && !calendar.getProperty("disabled")) {
          calDavCount++;
      }
  }

	dump("extensions/folder update starts after: " + calDavCount + " cals\n");

	if (calDavCount > 0) {
// composite observer
      let SICalStartupObserver = {
      counter: 0,
      maxCount: calDavCount,
      onLoad: function(calendar) {
              this.counter++;
              dump("counter: " + this.counter + "\n");
              if (this.counter >= this.maxCount) {
                  compCalendar.removeObserver(this);
                  dump("calendars loaded, now checking extensions\n");
                  checkExtensionsUpdate();
              }
          },
      onStartBatch: function(calendar) {},
      onEndBatch: function(calendar) {},
      onAddItem: function(aItem) {},
      onModifyItem: function(newItem, oldItem) {},
      onDeleteItem: function(aItem) {},
      onError: function(calendar, errNo, msg) {},
      onPropertyChanged: function(aCalendar, aName, aValue, aOldValue) {},
      onPropertyDeleting: function(aCalendar, aName) {}
      };

      compCalendar.addObserver(SICalStartupObserver);
      handled = true;
	}

	return handled;
}

function _getVersionTags(versionString) {
    let currentVersionTags = [];

    let currentString = versionString;
    let dotIndex = currentString.indexOf(".");
    if (dotIndex == 0) {
        currentString = "0" + currentString;
        dotIndex++;
    }
    while (dotIndex > -1) {
        let currentTag = currentString.substr(0, dotIndex);
        currentVersionTags.push(parseInt(currentTag));
        currentString = currentString.substr(dotIndex + 1);
        dotIndex = currentString.indexOf(".");
    }
    currentVersionTags.push(parseInt(currentString));

    return currentVersionTags;
}

function checkExtensionVersion(currentVersion, minVersion, strict) {
    let acceptable = true;

    let stop = false;

    let currentVersionTags = _getVersionTags(currentVersion);
    let minVersionTags = _getVersionTags(minVersion);
    if (currentVersionTags.length > minVersionTags.length) {
        let delta = currentVersionTags.length - minVersionTags.length;
        for (let i = 0; i < delta; i++) {
            minVersionTags.push(0);
        }
    }
    else if (currentVersionTags.length < minVersionTags.length) {
        let delta = minVersionTags.length - currentVersionTags.length;
        for (let i = 0; i < delta; i++) {
            currentVersionTags.push(0);
        }
    }

    let max = currentVersionTags.length;
    for (let i = 0; !stop && i < max; i++) {
        if (currentVersionTags[i] != minVersionTags[i]) {
            stop = true;
            if (strict
                || currentVersionTags[i] < minVersionTags[i])
                acceptable = false;
        }
    }

    return acceptable;
}

function deferredCheckFolders() {
    jsInclude(["chrome://sogo-integrator/content/messenger/folders-update.js"]);
    window.setTimeout(checkFolders, 100);
}

// forced prefs
function force_int_pref(key, value) {
    forcedPrefs[key] = { type: "int", value: value };
}

function force_bool_pref(key, value) {
    forcedPrefs[key] = { type: "bool", value: value };
}

function force_char_pref(key, value) {
    forcedPrefs[key] = { type: "char", value: value };
}

function applyForcedPrefs() {
    let prefService = Components.classes["@mozilla.org/preferences;1"]
        .getService(Components.interfaces.nsIPrefBranch);
    for (let key in forcedPrefs) {
        let pref = forcedPrefs[key];
        if (pref["type"] == "int") {
            prefService.setIntPref(key, pref["value"]);
        }
        else if (pref["type"] == "bool") {
            prefService.setBoolPref(key, pref["value"]);
        }
        else if (pref["type"] == "char") {
            prefService.setCharPref(key, pref["value"]);
        }
        else
            dump("unsupported pref type: " + pref["type"] + "\n");
    }
}

// startup
window.addEventListener("load", sogoIntegratorStartupOverlayOnLoad, false);
