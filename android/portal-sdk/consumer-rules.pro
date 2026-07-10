# Amthal Portal SDK — consumer rules.
# The web<->native bridge relies on a @JavascriptInterface object; its method
# names must survive minification in the consuming app.
-keepattributes JavascriptInterface
-keepclassmembers class com.amthalgroup.portal.internal.BridgeController$JsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
