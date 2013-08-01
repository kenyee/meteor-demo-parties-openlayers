meteor-demo-parties-openlayers
==============================

This is a modified version of Meteor.js' 
[Parties Example](http://www.meteor.com/examples/parties).

It was modified to:

* use OpenLayers for the live map instead of using a static image that
is read from OpenStreetMaps
* use OpenLayers Markers instead of D3.js so real GPS coordinates
could be stored instead of screen coordinates

so it could be used to test an Android DDP library (to interact
with the party data) and 
[sample app](https://play.google.com/store/apps/details?id=com.keysolutions.meteorparties&hl=en)
that acts as a Native Android client to this web site.

This application is also live at
[demoparties.meteor.com](http://demoparties.meteor.com)

