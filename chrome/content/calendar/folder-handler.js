function CalendarHandler() {
    this.doubles = [];
    this.mgr = (Components.classes["@mozilla.org/calendar/manager;1"]
                          .getService(Components.interfaces.calICalendarManager)
                          .wrappedJSObject);
}

let _topmostWindow = null;

function topmostWindow() {
    if (!_topmostWindow) {
        let currentTop = window;
        while (currentTop.opener)
            currentTop = currentTop.opener;

        _topmostWindow = currentTop;
    }

    return _topmostWindow;
}

CalendarHandler.prototype = {
    getExistingDirectories: function getExistingDirectories() {
        let existing = {};

        let cals = this.mgr.getCalendars({});
        for (let i = 0; i < cals.length; i++) {
            if (cals[i].type == "caldav") {
                if (existing[cals[i].uri.spec]) {
                    this.doubles.push(cals[i]);
                }
                else {
                    existing[cals[i].uri.spec] = cals[i];
                }
            }
        }

        return existing;
    },
    removeHomeCalendar: function removeHomeCalendar() {
        let cals = this.mgr.getCalendars({});

        for each (let cal in cals) {
            if (cal.type == "storage" && cal.uri.spec == "moz-profile-calendar://") {
                let dbService = Components.classes["@mozilla.org/storage/service;1"].getService(Components.interfaces.mozIStorageService);
                let mDB = dbService.openSpecialDatabase("profile");
                let stmt = mDB.createStatement("select (select count(*) from cal_events where cal_id = 0) + (select count(*) from cal_todos where cal_id = 0)");
                let count = 0;

                if (stmt.executeStep()) {
                    count += stmt.getInt32(0);
                }
                stmt.reset();

                if (count == 0) {
                    this.mgr.unregisterCalendar(cal);
                    this.mgr.deleteCalendar(cal);
                }
            }
        }
    },
    removeDoubles: function removeDoubles() {
        this.removeDirectories(this.doubles);
    },
    _setDirectoryProperties: function _setDirectoryProperties(directory,
                                                              properties,
                                                              isNew) {
        let displayName = properties['displayName'];
        let color = null;
        let props = properties.additional;
        if (props) {
            if (props[0]) {
                color = props[0].substr(0, 7).toUpperCase(); /* calendar-color */
            }
            let sogoProps = ["notify-on-personal-modifications",
                             "notify-on-external-modifications",
                             "notify-user-on-personal-modifications",
                             "notified-user-on-personal-modifications"];
            let counter = 1;
            for each (let sogoProp in sogoProps) {
                if (props[counter]) {
                    let propName = "calendar.sogo." + sogoProp;
                    directory.setProperty(propName, props[counter]);
                }
                counter++;
            }
        }

        directory.name = displayName;
        if (isNew) {
            let urlArray = directory.uri.spec.split("/");
            let urlFolder = urlArray[7];

            // We enable alarms, today pane and invitations ONLY for "folder"
            // owners.
            // All subscribtions's alarms are ignored by default.
            if (directory.uri.spec.indexOf('_') > -1) {
                directory.setProperty("showInTodayPane", false);
                directory.setProperty("showInvitations", false);
                directory.setProperty("suppressAlarms", true);
            }
            else {
                directory.setProperty("showInTodayPane", true);
                directory.setProperty("showInvitations", true);
                directory.setProperty("suppressAlarms", false);
            }
        }
        if (color)
            directory.setProperty("color", color);
    },
    addDirectories: function addDirectories(newDirs) {
        let ioSvc = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService);

        dump("addDirectories\n");
        for (let i = 0; i < newDirs.length; i++) {
            let newURI = ioSvc.newURI(newDirs[i]['url'], null, null);
            let newCalendar = this.mgr.createCalendar("caldav", newURI);
            this.mgr.registerCalendar(newCalendar, true);
            this._setDirectoryProperties(newCalendar, newDirs[i], true);
        }
    },
    renameDirectories: function renameDirectories(dirs) {
        for (let i = 0; i < dirs.length; i++)
            // 			dump("renaming calendar: " + dirs[i]['url'] + "\n");
            this._setDirectoryProperties(dirs[i]['folder'], dirs[i]);
    },
    removeDirectories: function removeDirectories(oldDirs) {
        for (let i = 0; i < oldDirs.length; i++) {
            // 			dump("removing calendar: " + oldDirs[i] + "\n");
            this.mgr.unregisterCalendar(oldDirs[i]);
            this.mgr.deleteCalendar(oldDirs[i]);
        }
    },
    urlForParentDirectory: function urlForParentDirectory() {
        return sogoBaseURL() + "Calendar";
    },
    additionalDAVProperties: function additionalDAVProperties() {
        return ["http://apple.com/ns/ical/ calendar-color",
                "urn:inverse:params:xml:ns:inverse-dav notify-on-personal-modifications",
                "urn:inverse:params:xml:ns:inverse-dav notify-on-external-modifications",
                "urn:inverse:params:xml:ns:inverse-dav notify-user-on-personal-modifications",
                "urn:inverse:params:xml:ns:inverse-dav notified-user-on-personal-modifications"
                ];
    }
};
