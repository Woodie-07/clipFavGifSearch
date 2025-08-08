/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { useCallback, useEffect, useRef, useState } from "@webpack/common";

interface SearchBarComponentProps {
    ref?: React.MutableRefObject<any>;
    autoFocus: boolean;
    className: string;
    size: string;
    onChange: (query: string) => void;
    onClear: () => void;
    query: string;
    placeholder: string;
}

type TSearchBarComponent =
    React.FC<SearchBarComponentProps>;

interface Gif {
    format: number;
    src: string;
    width: number;
    height: number;
    order: number;
    url: string;
}

interface Instance {
    dead?: boolean;
    state: {
        resultType?: string;
    };
    props: {
        favCopy: Gif[],

        favorites: Gif[],
    },
    forceUpdate: () => void;
}

// Track indexing state
let lastIndexedFavorites: string[] = [];
let indexedModels: Set<number> = new Set();
let pendingIndexRequest = false;
let lastRankingWeights = { VideoCLIP_XL_v2: 0.5, X_CLIP: 0.5 };


const containerClasses: { searchBar: string; } = findByPropsLazy("searchBar", "searchBarFullRow");

// Function to send index request
async function sendIndexRequest(favorites: Gif[]) {
    if (pendingIndexRequest || settings.store.user_key === "UNSET" || settings.store.user_key.length !== 32) {
        return;
    }

    // Filter and validate gifs
    const validGifs: { name: string; src: string; }[] = [];

    for (const gif of favorites) {
        const name = gif.url;

        // Check name length
        if (name.length > 512) {
            console.log(`skipping ${name} as ${name.length} > 512 characters`);
            continue;
        }

        // Check src length
        if (gif.src.length > 2000) {
            console.log(`skipping ${name} as ${gif.src.length} > 2000 characters`);
            continue;
        }

        // Check src protocol and extract domain
        let domainOffset: number;
        if (gif.src.startsWith("http://")) {
            domainOffset = 7;
        } else if (gif.src.startsWith("https://")) {
            domainOffset = 8;
        } else {
            console.log(`skipping ${name} as invalid src: ${gif.src}`);
            continue;
        }

        const pathIdx = gif.src.indexOf('/', domainOffset);
        const endIdx = pathIdx === -1 ? gif.src.length : pathIdx;
        const domain = gif.src.substring(domainOffset, endIdx);

        // Check domain validity
        if (!domain || domain.length > 256 || (!domain.endsWith(".discordapp.net") && domain !== "media.tenor.co")) {
            console.log(`skipping ${name} as invalid domain: ${domain}`);
            continue;
        }

        validGifs.push({ name, src: gif.src });
    }

    // Only proceed if we have valid gifs
    if (validGifs.length === 0) {
        console.log("No valid gifs to index");
        return;
    }

    const names = validGifs.map(gif => gif.name);
    const srcs = validGifs.map(gif => gif.src);

    // Get models with ranking weight > 0
    const models: number[] = [];
    if (settings.store.VideoCLIP_XL_v2_ranking > 0) {
        models.push(0);
    }
    if (settings.store.X_CLIP_ranking > 0) {
        models.push(1);
    }

    // Only send if we have models with weight > 0
    if (models.length === 0) {
        return;
    }

    const requestData = {
        names: names,
        media_srcs: srcs,
        models: models
    };

    try {
        pendingIndexRequest = true;
        const response = await fetch(`${settings.store.api_url}/${settings.store.user_key}/index`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Update tracking state on success
        lastIndexedFavorites = [...names];
        models.forEach(model => indexedModels.add(model));
        lastRankingWeights.VideoCLIP_XL_v2 = settings.store.VideoCLIP_XL_v2_ranking;
        lastRankingWeights.X_CLIP = settings.store.X_CLIP_ranking;

        console.log(`Successfully indexed ${names.length} valid favorites`);
    } catch (error) {
        console.error('Error indexing favorites:', error);
    } finally {
        pendingIndexRequest = false;
    }
}

// Function to get valid gif URLs (applying the same filters as indexing)
function getValidGifUrls(favorites: Gif[]): string[] {
    const validUrls: string[] = [];

    for (const gif of favorites) {
        const name = gif.url;

        // Check name length
        if (name.length > 512) continue;

        // Check src length
        if (gif.src.length > 2000) continue;

        // Check src protocol and extract domain
        let domainOffset: number;
        if (gif.src.startsWith("http://")) {
            domainOffset = 7;
        } else if (gif.src.startsWith("https://")) {
            domainOffset = 8;
        } else {
            continue;
        }

        const pathIdx = gif.src.indexOf('/', domainOffset);
        const endIdx = pathIdx === -1 ? gif.src.length : pathIdx;
        const domain = gif.src.substring(domainOffset, endIdx);

        // Check domain validity
        if (!domain || domain.length > 256 || (!domain.endsWith(".discordapp.net") && domain !== "media.tenor.co")) {
            continue;
        }

        validUrls.push(name);
    }

    return validUrls;
}

// Function to check if indexing is needed
function shouldIndex(favorites: Gif[]): boolean {
    const currentValidUrls = getValidGifUrls(favorites);

    // Check if valid favorites changed
    if (currentValidUrls.length !== lastIndexedFavorites.length ||
        !currentValidUrls.every((url, index) => url === lastIndexedFavorites[index])) {
        return true;
    }

    // Check if any model weight increased from 0 and hasn't been indexed
    const currentVideoCLIPWeight = settings.store.VideoCLIP_XL_v2_ranking;
    const currentXCLIPWeight = settings.store.X_CLIP_ranking;

    if (lastRankingWeights.VideoCLIP_XL_v2 === 0 && currentVideoCLIPWeight > 0 && !indexedModels.has(0)) {
        return true;
    }
    if (lastRankingWeights.X_CLIP === 0 && currentXCLIPWeight > 0 && !indexedModels.has(1)) {
        return true;
    }

    // Check if any model with weight > 0 hasn't been indexed
    if (currentVideoCLIPWeight > 0 && !indexedModels.has(0)) {
        return true;
    }
    if (currentXCLIPWeight > 0 && !indexedModels.has(1)) {
        return true;
    }

    return false;
}

export const settings = definePluginSettings({
    api_url: {
        type: OptionType.STRING,
        description: "CLIP API URL",
        default: "https://gif-search.woodie.dev"
    },
    user_key: {
        type: OptionType.STRING,
        description: "User key (randomly generated per-user index identifier)",
        default: "UNSET"
    },
    VideoCLIP_XL_v2_ranking: {
        type: OptionType.SLIDER,
        description: "VideoCLIP XL v2 Ranking Weight",
        markers: [0, 1],
        default: 0.5,
        stickToMarkers: false
    },
    X_CLIP_ranking: {
        type: OptionType.SLIDER,
        description: "X-CLIP Ranking Weight",
        markers: [0, 1],
        default: 0.5,
        stickToMarkers: false
    }
});


export default definePlugin({
    name: "ClipFavGifSearch",
    authors: [Devs.Aria, { name: "Woodie", id: 851073836152651777n }],
    description: "Adds a CLIP search bar to favorite gifs.",

    start() {
        if (settings.store.user_key === "UNSET") {
            const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            let key = "";
            for (let i = 0; i < 32; i++) {
                key += charset.charAt(Math.floor(Math.random() * charset.length));
            }
            settings.store.user_key = key;
        }

        // Initialize tracking weights
        lastRankingWeights.VideoCLIP_XL_v2 = settings.store.VideoCLIP_XL_v2_ranking;
        lastRankingWeights.X_CLIP = settings.store.X_CLIP_ranking;
    },

    patches: [
        {
            find: "renderHeaderContent()",
            replacement: [
                {
                    // https://regex101.com/r/07gpzP/1
                    // ($1 renderHeaderContent=function { ... switch (x) ... case FAVORITES:return) ($2) ($3 case default:return r.jsx(($<searchComp>), {...props}))
                    match: /(renderHeaderContent\(\).{1,150}FAVORITES:return)(.{1,150});(case.{1,200}default:return\(0,\i\.jsx\)\((?<searchComp>\i\..{1,10}),)/,
                    replace: "$1 this.state.resultType === 'Favorites' ? $self.renderSearchBar(this, $<searchComp>) : $2;$3"
                },
                {
                    // to persist filtered favorites when component re-renders.
                    // when resizing the window the component rerenders and we loose the filtered favorites and have to type in the search bar to get them again
                    match: /(,suggestions:\i,favorites:)(\i),/,
                    replace: "$1$self.getFav($2),favCopy:$2,"
                }

            ]
        }
    ],

    settings,

    instance: null as Instance | null,
    renderSearchBar(instance: Instance, SearchBarComponent: TSearchBarComponent) {
        this.instance = instance;
        return (
            <ErrorBoundary noop>
                <SearchBar instance={instance} SearchBarComponent={SearchBarComponent} />
            </ErrorBoundary>
        );
    },

    getFav(favorites: Gif[]) {
        if (!this.instance || this.instance.dead) return favorites;
        const { favorites: filteredFavorites } = this.instance.props;

        const favoritesToReturn = filteredFavorites != null && filteredFavorites?.length !== favorites.length ? filteredFavorites : favorites;

        // Check if we need to index favorites (only check the original favorites, not filtered ones)
        if (shouldIndex(favorites)) {
            sendIndexRequest(favorites);
        }

        return favoritesToReturn;
    }
});


function SearchBar({ instance, SearchBarComponent }: { instance: Instance; SearchBarComponent: TSearchBarComponent; }) {
    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const ref = useRef<{ containerRef?: React.MutableRefObject<HTMLDivElement>; } | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Check for ranking weight changes and trigger indexing if needed
    useEffect(() => {
        if (instance.props.favCopy && shouldIndex(instance.props.favCopy)) {
            sendIndexRequest(instance.props.favCopy);
        }
    });

    const onChange = useCallback((searchQuery: string) => {
        setQuery(searchQuery);

        // Clear existing debounce timeout
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }

        // Cancel any ongoing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        // Handle empty query immediately
        if (searchQuery === "") {
            setDebouncedQuery("");
            const { props } = instance;
            props.favorites = props.favCopy;
            instance.forceUpdate();
            return;
        }

        // Debounce the search - wait 300ms after user stops typing
        debounceTimeoutRef.current = setTimeout(() => {
            setDebouncedQuery(searchQuery);
        }, 300);
    }, [instance]);

    // Effect to handle the actual search when debouncedQuery changes
    useEffect(() => {
        if (debouncedQuery === "") return;

        const performSearch = async () => {
            const { props } = instance;

            if (settings.store.user_key.length !== 32) return;

            // Create new AbortController for this request
            abortControllerRef.current = new AbortController();

            // scroll back to top
            ref.current?.containerRef?.current
                .closest("#gif-picker-tab-panel")
                ?.querySelector("[class|=\"content\"]")
                ?.firstElementChild?.scrollTo(0, 0);

            try {
                const response = await fetch(`${settings.store.api_url}/${settings.store.user_key}/search?text=${encodeURIComponent(debouncedQuery)}`, {
                    signal: abortControllerRef.current.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                let weights: Record<string, number> = {
                    "0": settings.store.VideoCLIP_XL_v2_ranking,
                    "1": settings.store.X_CLIP_ranking
                };

                const data = await response.json();
                const modelResults = data.results as Record<string, [string, number][]>;

                // Step 1: Build ranking maps per model
                const rankingMaps: Record<string, Map<string, number>> = {};
                Object.entries(modelResults).forEach(([modelId, results]) => {
                    const sorted = [...results].sort((a, b) => a[1] - b[1]); // sort by ascending score (lower = better)
                    const map = new Map<string, number>();
                    sorted.forEach(([url], idx) => {
                        map.set(url, idx + 1); // rank 1 = best
                    });
                    rankingMaps[modelId] = map;
                });

                // Step 2: Collect all URLs
                const allUrls = new Set<string>();
                Object.values(modelResults).forEach(results => {
                    results.forEach(([url]) => allUrls.add(url));
                });

                // Step 3: Aggregate weighted ranks
                const aggregated = Array.from(allUrls).map(url => {
                    let totalScore = 0;
                    let totalWeight = 0;

                    for (const [modelId, rankMap] of Object.entries(rankingMaps)) {
                        const weight = weights[modelId] ?? 0.5;
                        const rank = rankMap.get(url);
                        if (rank !== undefined) {
                            const score = 1 / rank; // inverse rank: higher = better
                            totalScore += score * weight;
                            totalWeight += weight;
                        }
                    }

                    if (totalWeight === 0) return null;

                    const gif = props.favCopy.find(g => g.url === url);
                    return gif ? { combinedScore: totalScore / totalWeight, gif } : null;
                }).filter(Boolean) as { combinedScore: number, gif: Gif; }[];

                aggregated.sort((a, b) => b.combinedScore - a.combinedScore); // higher = better
                props.favorites = aggregated.map(e => e.gif);
                instance.forceUpdate();
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    console.log('Fetch aborted');
                    return; // Don't update UI or log error for aborted requests
                }
                console.error("Error fetching search results:", err);
                instance.forceUpdate();
            }
        };

        performSearch();
    }, [debouncedQuery, instance]);

    useEffect(() => {
        return () => {
            // Clear debounce timeout on unmount
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
            // Cancel any ongoing request when component unmounts
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            instance.dead = true;
        };
    }, []);

    return (
        <SearchBarComponent
            ref={ref}
            autoFocus={true}
            className={containerClasses.searchBar}
            size="md"
            onChange={onChange}
            onClear={() => {
                // Clear debounce timeout when clearing
                if (debounceTimeoutRef.current) {
                    clearTimeout(debounceTimeoutRef.current);
                }
                // Cancel any ongoing request when clearing
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                }
                setQuery("");
                setDebouncedQuery("");
                if (instance.props.favCopy != null) {
                    instance.props.favorites = instance.props.favCopy;
                    instance.forceUpdate();
                }
            }}
            query={query}
            placeholder="CLIP Search Favorite Gifs"
        />
    );
}
