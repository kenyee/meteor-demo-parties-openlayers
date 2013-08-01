// All Tomorrow's Parties -- client

Meteor.subscribe("directory");
Meteor.subscribe("parties");

// If no party selected, select one.
Meteor.startup(function () {
  Deps.autorun(function () {
    if (! Session.get("selected")) {
      var party = Parties.findOne();
      if (party)
        Session.set("selected", party._id);
    }
  });
});

///////////////////////////////////////////////////////////////////////////////
// Party details sidebar

Template.details.party = function () {
  return Parties.findOne(Session.get("selected"));
};

Template.details.anyParties = function () {
  return Parties.find().count() > 0;
};

Template.details.creatorName = function () {
  var owner = Meteor.users.findOne(this.owner);
  if (owner._id === Meteor.userId())
    return "me";
  return displayName(owner);
};

Template.details.canRemove = function () {
  return this.owner === Meteor.userId() && attending(this) === 0;
};

Template.details.maybeChosen = function (what) {
  var myRsvp = _.find(this.rsvps, function (r) {
    return r.user === Meteor.userId();
  }) || {};

  return what == myRsvp.rsvp ? "chosen btn-inverse" : "";
};

Template.details.events({
  'click .rsvp_yes': function () {
    Meteor.call("rsvp", Session.get("selected"), "yes");
    return false;
  },
  'click .rsvp_maybe': function () {
    Meteor.call("rsvp", Session.get("selected"), "maybe");
    return false;
  },
  'click .rsvp_no': function () {
    Meteor.call("rsvp", Session.get("selected"), "no");
    return false;
  },
  'click .invite': function () {
    openInviteDialog();
    return false;
  },
  'click .remove': function () {
    Parties.remove(this._id);
    return false;
  }
});

///////////////////////////////////////////////////////////////////////////////
// Party attendance widget

Template.attendance.rsvpName = function () {
  var user = Meteor.users.findOne(this.user);
  return displayName(user);
};

Template.attendance.outstandingInvitations = function () {
  var party = Parties.findOne(this._id);
  return Meteor.users.find({$and: [
    {_id: {$in: party.invited}}, // they're invited
    {_id: {$nin: _.pluck(party.rsvps, 'user')}} // but haven't RSVP'd
  ]});
};

Template.attendance.invitationName = function () {
  return displayName(this);
};

Template.attendance.rsvpIs = function (what) {
  return this.rsvp === what;
};

Template.attendance.nobody = function () {
  return ! this.public && (this.rsvps.length + this.invited.length === 0);
};

Template.attendance.canInvite = function () {
  return ! this.public && this.owner === Meteor.userId();
};

///////////////////////////////////////////////////////////////////////////////
// Map display

// Use jquery to get the position clicked relative to the map element.
var coordsRelativeToElement = function (element, event) {
  var offset = $(element).offset();
  var x = event.pageX - offset.left;
  var y = event.pageY - offset.top;
  return { x: x, y: y };
};

/*
// old D3 code
Template.map.events({
  'mousedown circle, mousedown text': function (event, template) {
    Session.set("selected", event.currentTarget.id);
  },
  'dblclick .map': function (event, template) {
    if (! Meteor.userId()) // must be logged in to create events
      return;
//alert("Lat, Lon : " + event.latlng.lat + ", " + event.latlng.lng);
    var coords = coordsRelativeToElement(event.currentTarget, event);
    openCreateDialog(coords.x / 500, coords.y / 500, 0, 0);
  }
});
*/

var radius = function (party) {
   return 10 + Math.sqrt(attending(party)) * 10;
};

// Draw a circle for each party
var updateCircles = function (group, selected) {
   group.attr("id", function (party) { return party._id; })
        .attr("cx", function (party) { return party.x * 500; })
        .attr("cy", function (party) { return party.y * 500; })
        .attr("r", radius)
        .attr("class", function (party) {
          return party.public ? "public" : "private";
        })
        .style('opacity', function (party) {
          return selected === party._id ? 1 : 0.6;
        });
};

// Label each with the current attendance count
var updateLabels = function (group) {
   group.attr("id", function (party) { return party._id; })
        .text(function (party) {return attending(party) || '';})
        .attr("x", function (party) { return party.x * 500; })
        .attr("y", function (party) { return party.y * 500 + radius(party)/2 })
        .style('font-size', function (party) {
          return radius(party) * 1.25 + "px";
        });
};

Template.map.rendered = function () {
  var self = this;
  self.node = self.find("svg");

  if (! self.handle) {
    self.handle = Deps.autorun(function () {
      var selected = Session.get('selected');
      var selectedParty = selected && Parties.findOne(selected);

      //this is the old D3 code
      //initD3(selected, selectedParty);

      // draw party markers on live OpenLayers map
      updateMarkersOSM(selected, selectedParty);
    });
  }

  initOSM(); 

};

function initD3(selected, selectedParty) {
      var circles = d3.select(self.node).select(".circles").selectAll("circle")
        .data(Parties.find().fetch(), function (party) { return party._id; });

      updateCircles(circles.enter().append("circle"), selected);
      updateCircles(circles.transition().duration(250).ease("cubic-out"), selected);
      circles.exit().transition().duration(250).attr("r", 0).remove();

      var labels = d3.select(self.node).select(".labels").selectAll("text")
        .data(Parties.find().fetch(), function (party) { return party._id; });

      updateLabels(labels.enter().append("text"));
      updateLabels(labels.transition().duration(250).ease("cubic-out"));
      labels.exit().remove();

      // Draw a dashed circle around the currently selected party, if any
      var callout = d3.select(self.node).select("circle.callout")
        .transition().duration(250).ease("cubic-out");
      if (selectedParty)
        callout.attr("cx", selectedParty.x * 500)
        .attr("cy", selectedParty.y * 500)
        .attr("r", radius(selectedParty) + 10)
        .attr("class", "callout")
        .attr("display", '');
      else
        callout.attr("display", 'none');
}

function projectToPoint(lon, lat) {
  var point = mapOSM.getViewPortPxFromLonLat(new OpenLayers.LonLat(lon, lat)
			.transform("EPSG:4326", "EPSG:900913"));
  return [point.x, point.y];
}

var popupOSM = null;
//  mouseover event handler
function handleMarkerOSMMouseOver(evt) {
    hidePopupOSM();
    var position = this.events.getMousePosition(evt);
    var lonlat = evt.object.lonlat;
    popupOSM = new OpenLayers.Popup.FramedCloud("Popup",
        lonlat,
        null,
        '<div><h5>' + evt.object.party.title + 
        '&nbsp;&nbsp;</h5>' + attending(evt.object.party) + 
        ' attendees&nbsp;&nbsp;&nbsp; </div>',
        null,
        false,
        true);
    mapOSM.addPopup(popupOSM);
}
  
function hidePopupOSM() {
  if (popupOSM) {
    popupOSM.hide();
    mapOSM.removePopup(popupOSM);
  }
}


function updateMarkersOSM(selected, selectedParty) {
  if (!markersOSM) {
    return;
  }
  markersOSM.clearMarkers();
  var size = new OpenLayers.Size(16,27);
  var offset = new OpenLayers.Pixel(-(size.w/2), -size.h);
  var iconSel = new OpenLayers.Icon('http://www.google.com/mapfiles/marker.png', size, offset);
  var icon = new OpenLayers.Icon('http://labs.google.com/ridefinder/images/mm_20_green.png', size, offset);
  var fromProjection = new OpenLayers.Projection("EPSG:4326");   // Transform from WGS 1984
  var toProjection   = new OpenLayers.Projection("EPSG:900913"); // to Spherical Mercator Projectiona
  var parties = Parties.find();
  parties.forEach(function (party) {
   if (!party.marker) {
     var position = new OpenLayers.LonLat(party.lon, party.lat).transform( fromProjection, toProjection);
     var marker = new OpenLayers.Marker(position,
        (selected == party._id) ? iconSel.clone() : icon.clone());
     marker.party = party;
     marker.events.register("click", marker, function(e) {
       //alert("Marker clicked: " + marker.party._id);
       // update details
       Session.set("selected", e.object.party._id);
       hidePopupOSM()
     });
     marker.events.register('mouseover', marker, handleMarkerOSMMouseOver);
     marker.events.register('mouseout', marker, hidePopupOSM);
     markersOSM.addMarker(marker);
   }
  });
}

var mapOSM = null;
var markersOSM = null;
var overlayOSM = null;

function initOSM() {
  if (mapOSM) {
    // don't do a double init because .rendered gets called multiple times
    return;
  }

  OpenLayers.Control.Click = OpenLayers.Class(OpenLayers.Control, {                
    defaultHandlerOptions: {
      'single': false,
      'double': true,
      'pixelTolerance': 0,
      'stopSingle': true,
      'stopDouble': true
    },

    initialize: function(options) {
      this.handlerOptions = OpenLayers.Util.extend(
        {}, this.defaultHandlerOptions
      );
      OpenLayers.Control.prototype.initialize.apply(
        this, arguments
      ); 
      this.handler = new OpenLayers.Handler.Click(
        this, {
          'click': this.onClick,
          'dblclick': this.onDblclick 
        }, this.handlerOptions
      );
    }, 

    onClick: function(evt) {
      var msg = "click " + evt.xy;
      alert(msg);
    },

    onDblclick: function(evt) {  
      var msg = "dblclick " + evt.xy;
      var lonlat = mapOSM.getLonLatFromPixel(evt.xy);
      var xlonlat = lonlat.transform(new OpenLayers.Projection("EPSG:900913"), new OpenLayers.Projection("EPSG:4326"));
      openCreateDialog(evt.xy.x / 500, evt.xy.y / 500, xlonlat.lat, xlonlat.lon);
    }

  });

  mapOSM = map = new OpenLayers.Map("map");
  var mapnik         = new OpenLayers.Layer.OSM();
  var fromProjection = new OpenLayers.Projection("EPSG:4326");   // Transform from WGS 1984
  var toProjection   = new OpenLayers.Projection("EPSG:900913"); // to Spherical Mercator Projection
  var position       = new OpenLayers.LonLat(-122.40146, 37.78212).transform( fromProjection, toProjection);
  var zoom           = 15; 
 
  map.addLayer(mapnik);

  control = new OpenLayers.Control.Click();
  map.addControl(control);
  control.activate();
      
  markersOSM = new OpenLayers.Layer.Markers( "Markers" );
  map.addLayer(markersOSM);

  // add overlay for D3
  //overlayOSM = new OpenLayers.Layer.Vector("Parties");
  //map.addLayer(overlayOSM);

  // position map and zoom ratio
  map.setCenter(position, zoom );
}


Template.map.destroyed = function () {
  this.handle && this.handle.stop();
};

///////////////////////////////////////////////////////////////////////////////
// Create Party dialog

var openCreateDialog = function (x, y, lat, lon) {
  Session.set("createCoords", {x: x, y: y, lat: lat, lon: lon});
  Session.set("createError", null);
  Session.set("showCreateDialog", true);
};

Template.page.showCreateDialog = function () {
  return Session.get("showCreateDialog");
};

Template.createDialog.events({
  'click .save': function (event, template) {
    var title = template.find(".title").value;
    var description = template.find(".description").value;
    var public = ! template.find(".private").checked;
    var coords = Session.get("createCoords");

    if (title.length && description.length) {
      Meteor.call('createParty', {
        title: title,
        description: description,
        x: coords.x,
        y: coords.y,
        lat: coords.lat,
        lon: coords.lon,
        public: public
      }, function (error, party) {
        if (! error) {
          Session.set("selected", party);
          if (! public && Meteor.users.find().count() > 1)
            openInviteDialog();
        }
      });
      Session.set("showCreateDialog", false);
    } else {
      Session.set("createError",
                  "It needs a title and a description, or why bother?");
    }
  },

  'click .cancel': function () {
    Session.set("showCreateDialog", false);
  }
});

Template.createDialog.error = function () {
  return Session.get("createError");
};

///////////////////////////////////////////////////////////////////////////////
// Invite dialog

var openInviteDialog = function () {
  Session.set("showInviteDialog", true);
};

Template.page.showInviteDialog = function () {
  return Session.get("showInviteDialog");
};

Template.inviteDialog.events({
  'click .invite': function (event, template) {
    Meteor.call('invite', Session.get("selected"), this._id);
  },
  'click .done': function (event, template) {
    Session.set("showInviteDialog", false);
    return false;
  }
});

Template.inviteDialog.uninvited = function () {
  var party = Parties.findOne(Session.get("selected"));
  if (! party)
    return []; // party hasn't loaded yet
  return Meteor.users.find({$nor: [{_id: {$in: party.invited}},
                                   {_id: party.owner}]});
};

Template.inviteDialog.displayName = function () {
  return displayName(this);
};
