# clipFavGifSearch
Vencord plugin to add a CLIP search bar to favourite GIFs.

This plugin was based off the existing 'favGifSearch' plugin in Vencord but modified for CLIP search, mostly with AI (for I am not a TypeScript developer) so **expect bugs**. PRs welcome!

With the plugin installed, when you next open your favourited GIFs menu, the GIF URLs will be sent to the configured server ([see server repository](https://github.com/Woodie-07/gif_search_clip_server)). By default, this is set to my hosted instance of the server software - of course you can run your own instance for privacy.

The 'user key' is a randomly generated identifier for your GIF index, so be aware that if someone has your user key they can make search requests to your index and hence retrieve your GIF URLs.

# Installation
See the [Vencord Docs](https://docs.vencord.dev/installing/custom-plugins/)

If you plan to set your own server URL, you'll probably need to add the domain to `CspPolicies` in native.ts. If any Vencord plugin developer knows of a better way, please let me know or submit a PR.
