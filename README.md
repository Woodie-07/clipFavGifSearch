# clipFavGifSearch
Vencord plugin to add a CLIP search bar to favourite GIFs.

This plugin was based off the existing 'favGifSearch' plugin in Vencord but modified for CLIP search, mostly with AI (for I am not a TypeScript developer) so **expect bugs**. PRs welcome!

With the plugin installed, when you next open your favourited GIFs menu, the GIF URLs will be sent to the configured server ([see server repository](https://github.com/Woodie-07/gif_search_clip_server)). By default, this is set to my hosted instance of the server software - of course you can run your own instance for privacy.

You'll notice a new search bar above your favourite GIFs menu, just like you would if searching Tenor. After entering a search term, the plugin will filter your GIFs list to the top 10 best matches (or possibly more if multiple models enabled), ordered by relevance. Only the GIFs that have been processed on the server side will be present in these results so you may notice many GIFs missing from the results if you've just installed the plugin for the first time. You may track the progress of the GIF indexing in the plugin settings menu.

Also in the plugin settings menu are some sliders to weight the rankings from the different models in the search results. By default, these sliders will be set to the recommended settings (VideoCLIP-XL-v2 is by far the best model currently implemented) but feel free to try some of the others. The 'account key' at the bottom is a randomly generated identifier for your GIF index, so be aware that if someone has your key they can make search requests to your index and hence retrieve your GIF URLs.

## Installation
See the [Vencord Docs](https://docs.vencord.dev/installing/custom-plugins/)

If you plan to set your own server URL, you'll probably need to add the domain to `CspPolicies` in native.ts. If any Vencord plugin developer knows of a better way, please let me know or submit a PR.

## Video
https://github.com/user-attachments/assets/802f24d2-7380-4798-a35a-95414f097821


