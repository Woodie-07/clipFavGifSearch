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
import { useCallback, useEffect, useRef, useState, Forms, Flex, Text, Slider, UserStore, TextInput, Button } from "@webpack/common";

interface SearchBarComponentProps {
    ref?: React.RefObject<any>;
    autoFocus: boolean;
    size: string;
    onChange: (query: string) => void;
    onClear: () => void;
    query: string;
    placeholder: string;
    className?: string;
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
let lastUserId: string | null = null;
let lastIndexedFavorites: string[] = [];
let indexedModels: Set<string> = new Set();
let pendingIndexRequest = false;
let lastRankingWeights: Record<string, number> = {};

function getModelWeights(): Record<string, number> {
    return settings.store.modelWeights ?? {};
}

// Function to send index request
async function sendIndexRequest(favorites: Gif[]) {
    const s = settings.store.accountKeys ??= {};
    const id = UserStore.getCurrentUser().id;
    if (pendingIndexRequest || s[id]?.length !== 32) {
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

    // Get models with ranking weight > 0 from private settings.modelWeights
    const models: string[] = [];
    const modelWeights: Record<string, number> = getModelWeights();
    for (const [name, weight] of Object.entries(modelWeights)) {
        if (weight > 0) models.push(name);
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
        const response = await fetch(`${settings.store.api_url}/${s[id]}/index`, {
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
        lastUserId = id;
        models.forEach(model => indexedModels.add(model));
        // copy current weights into lastRankingWeights
        lastRankingWeights = { ...modelWeights };

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
    if (lastUserId !== UserStore.getCurrentUser().id) return true;

    const currentValidUrls = getValidGifUrls(favorites);

    // Check if valid favorites changed
    if (currentValidUrls.length !== lastIndexedFavorites.length ||
        !currentValidUrls.every((url, index) => url === lastIndexedFavorites[index])) {
        return true;
    }

    const modelWeights: Record<string, number> = ((settings.store as any).modelWeights) ?? {};

    // If a model gained weight from 0 and hasn't been indexed, we should index
    for (const [model, weight] of Object.entries(modelWeights)) {
        const last = lastRankingWeights[model] ?? 0;
        if (last === 0 && weight > 0 && !indexedModels.has(model)) return true;
        if (weight > 0 && !indexedModels.has(model)) return true;
    }

    return false;
}

// Model weights settings component
function ModelWeightsComponent() {
    const [models, setModels] = useState<Record<string, number>>(() => getModelWeights());

    useEffect(() => {
        // if we don't have models in settings, try fetching from API
        if (Object.keys(models).length === 0) {
            (async () => {
                try {
                    const response = await fetch(`${settings.store.api_url}/models`);
                    if (!response.ok) return;
                    const remote = await response.json() as Record<string, number>;
                    const combined = { ...remote, ...getModelWeights() };
                    setModels(combined);
                    (settings.store as any).modelWeights = combined;
                } catch (e) {
                    // ignore
                }
            })();
        }
    }, []);

    function setModelWeight(name: string, weight: number) {
        const next = { ...models, [name]: weight };
        setModels(next);
        (settings.store as any).modelWeights = next;
    }

    return (
        <Forms.FormSection>
            <Forms.FormTitle tag="h3">CLIP Models</Forms.FormTitle>
            <Forms.FormText>
                Adjust how model outputs are weighted when searching favorite GIFs.
            </Forms.FormText>

            <div style={{ marginTop: 8 }}>
                {Object.entries(models).map(([name, weight]) => (
                    <div key={name} style={{ marginBottom: 12 }}>
                        <Forms.FormTitle tag="h4">{name}</Forms.FormTitle>
                        <Flex direction={Flex.Direction.HORIZONTAL} style={{ alignItems: "center", gap: "0.75rem", marginTop: 6 }}>
                            <div style={{ flex: 1 }}>
                                <Slider
                                    markers={[0, 1]}
                                    minValue={0}
                                    maxValue={1}
                                    initialValue={weight}
                                    onValueChange={(v: number) => setModelWeight(name, v)}
                                    onValueRender={(v: number) => `${(v * 100).toFixed(0)}%`}
                                    stickToMarkers={false}
                                />
                            </div>
                            <Text variant={"text-xs/normal"} style={{ width: 54, textAlign: "right", color: "var(--text-muted)" }}>
                                {(weight * 100).toFixed(0)}%
                            </Text>
                        </Flex>
                    </div>
                ))}
            </div>

            <Forms.FormDivider style={{ marginTop: 6 }} />
        </Forms.FormSection>
    );
}

// Status counts component
function StatusCountsComponent() {
    const [statusData, setStatusData] = useState<{
        counts: Record<string, [number, number, number, number]>;
        status: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        const fetchStatusCounts = async () => {
            try {
                const s = settings.store.accountKeys ??= {};
                const id = UserStore.getCurrentUser().id;

                if (!s[id] || s[id].length !== 32) {
                    setError("No valid account key found");
                    setLoading(false);
                    return;
                }

                const response = await fetch(`${settings.store.api_url}/${s[id]}/statuscounts`);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                setStatusData(data);
                setError(null);
            } catch (err: any) {
                console.error('Error fetching status counts:', err);
                setError(err.message || 'Failed to fetch status counts');
            } finally {
                setLoading(false);
            }
        };

        // Initial fetch
        fetchStatusCounts();

        // Set up polling every 5 seconds
        intervalId = setInterval(fetchStatusCounts, 5000);

        // Cleanup interval on unmount
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, []);

    const getStatusLabel = (index: number): string => {
        switch (index) {
            case 0: return "Failed";
            case 1: return "Downloading";
            case 2: return "Processing";
            case 3: return "Completed";
            default: return "Unknown";
        }
    };

    const getStatusColor = (index: number): string => {
        switch (index) {
            case 0: return "var(--status-danger)";
            case 1: return "var(--status-warning)";
            case 2: return "var(--brand-500)";
            case 3: return "var(--status-positive)";
            default: return "var(--text-muted)";
        }
    };

    return (
        <Forms.FormSection>
            <Forms.FormTitle tag="h3">GIF Processing Status</Forms.FormTitle>
            <Forms.FormText>
                Real-time status of your GIF processing for each model.
            </Forms.FormText>

            <div style={{ marginTop: 12 }}>
                {loading && (
                    <Text variant={"text-sm/normal"} style={{ color: "var(--text-muted)" }}>
                        Loading status...
                    </Text>
                )}

                {error && (
                    <Text variant={"text-sm/normal"} style={{ color: "var(--status-danger)" }}>
                        Error: {error}
                    </Text>
                )}

                {statusData && statusData.counts && (
                    <div>
                        {Object.entries(statusData.counts).map(([modelName, counts]) => (
                            <div key={modelName} style={{ marginBottom: 16, padding: 12, backgroundColor: "var(--background-secondary)", borderRadius: 8 }}>
                                <Forms.FormTitle tag="h4" style={{ marginBottom: 8 }}>{modelName}</Forms.FormTitle>
                                <Flex direction={Flex.Direction.HORIZONTAL} style={{ gap: "1rem", flexWrap: "wrap" }}>
                                    {counts.map((count, index) => (
                                        <div key={index} style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            minWidth: 60
                                        }}>
                                            <Text
                                                variant={"text-lg/semibold"}
                                                style={{ color: getStatusColor(index) }}
                                            >
                                                {count}
                                            </Text>
                                            <Text
                                                variant={"text-xs/normal"}
                                                style={{ color: "var(--text-muted)", textAlign: "center" }}
                                            >
                                                {getStatusLabel(index)}
                                            </Text>
                                        </div>
                                    ))}
                                </Flex>
                            </div>
                        ))}
                    </div>
                )}

                {statusData && Object.keys(statusData.counts || {}).length === 0 && (
                    <Text variant={"text-sm/normal"} style={{ color: "var(--text-muted)" }}>
                        No processing data available
                    </Text>
                )}
            </div>

            <Forms.FormDivider style={{ marginTop: 6 }} />
        </Forms.FormSection>
    );
}

// User key editor component
function UserKeyComponent() {
    const [userKey, setUserKey] = useState(() => {
        const s = settings.store.accountKeys ??= {};
        const id = UserStore.getCurrentUser().id;
        return s[id] || "";
    });
    const [isVisible, setIsVisible] = useState(false);

    const saveUserKey = useCallback((newKey: string) => {
        const s = settings.store.accountKeys ??= {};
        const id = UserStore.getCurrentUser().id;
        s[id] = newKey;
        setUserKey(newKey);
    }, []);

    const generateNewKey = useCallback(() => {
        const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let key = "";
        for (let i = 0; i < 32; i++) {
            key += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        saveUserKey(key);
    }, [saveUserKey]);

    const copyToClipboard = useCallback(() => {
        navigator.clipboard.writeText(userKey);
    }, [userKey]);

    const displayValue = isVisible ? userKey : "•".repeat(userKey.length);

    return (
        <Forms.FormSection>
            <Forms.FormTitle tag="h3">Account Key</Forms.FormTitle>
            <Forms.FormText>
                Your unique account key for the CLIP API. This is automatically generated but can be changed.
            </Forms.FormText>

            <div style={{ marginTop: 12 }}>
                <Flex direction={Flex.Direction.HORIZONTAL} style={{ gap: "0.5rem", alignItems: "stretch" }}>
                    <div style={{ flex: 1 }}>
                        <TextInput
                            value={isVisible ? userKey : displayValue}
                            onChange={isVisible ? setUserKey : undefined}
                            onBlur={isVisible ? () => saveUserKey(userKey) : undefined}
                            placeholder="Enter 32-character key"
                            readOnly={!isVisible}
                            style={!isVisible ? { cursor: "default" } : undefined}
                        />
                    </div>
                    <Button
                        onClick={() => setIsVisible(!isVisible)}
                        size={Button.Sizes.SMALL}
                        look={Button.Looks.OUTLINED}
                        color={Button.Colors.PRIMARY}
                        style={{ minHeight: "32px" }}
                    >
                        {isVisible ? "Hide" : "Show"}
                    </Button>
                    <Button
                        onClick={copyToClipboard}
                        size={Button.Sizes.SMALL}
                        look={Button.Looks.OUTLINED}
                        color={Button.Colors.PRIMARY}
                        style={{ minHeight: "32px" }}
                    >
                        Copy
                    </Button>
                    <Button
                        onClick={generateNewKey}
                        size={Button.Sizes.SMALL}
                        look={Button.Looks.OUTLINED}
                        color={Button.Colors.PRIMARY}
                        style={{ minHeight: "32px" }}
                    >
                        Generate New
                    </Button>
                </Flex>
                {userKey.length > 0 && userKey.length !== 32 && (
                    <Text variant={"text-xs/normal"} style={{ color: "var(--status-warning)", marginTop: 4 }}>
                        Key should be exactly 32 characters long
                    </Text>
                )}
            </div>

            <Forms.FormDivider style={{ marginTop: 12 }} />
        </Forms.FormSection>
    );
}

export const settings = definePluginSettings({
    api_url: {
        type: OptionType.STRING,
        description: "CLIP API URL",
        default: "https://gif-search.woodie.dev"
    },
    hello_world_component: {
        type: OptionType.COMPONENT,
        component: ModelWeightsComponent
    },
    status_counts_component: {
        type: OptionType.COMPONENT,
        component: StatusCountsComponent
    },
    user_key_component: {
        type: OptionType.COMPONENT,
        component: UserKeyComponent
    },
}).withPrivateSettings<{ accountKeys?: Record<string, string>; modelWeights?: Record<string, number>; }>();


export default definePlugin({
    name: "ClipFavGifSearch",
    authors: [Devs.Aria, { name: "Woodie", id: 851073836152651777n }],
    description: "Adds a CLIP search bar to favorite gifs.",

    start() {
        // Initialize tracking weights from modelWeights
        lastRankingWeights = { ...getModelWeights() };

        // Try to fetch available models from the API and initialize weights if missing
        (async () => {
            try {
                const response = await fetch(`${settings.store.api_url}/models`);
                if (!response.ok) return;
                const models = await response.json() as Record<string, number>;
                const current = getModelWeights();
                let changed = false;
                for (const [name, weight] of Object.entries(models)) {
                    if (current[name] === undefined) {
                        current[name] = weight;
                        changed = true;
                    }
                }
                if (changed) {
                    (settings.store as any).modelWeights = current;
                    lastRankingWeights = { ...current };
                }
            } catch (e) {
                // ignore
            }
        })();
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

        const s = settings.store.accountKeys ??= {};
        const id = UserStore.getCurrentUser().id;
        if (s[id] === undefined) {
            const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            let key = "";
            for (let i = 0; i < 32; i++) {
                key += charset.charAt(Math.floor(Math.random() * charset.length));
            }
            s[id] = key;
        }


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
    const ref = useRef<{ containerRef?: React.RefObject<HTMLDivElement>; } | null>(null);
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

            const s = settings.store.accountKeys ??= {};
            const id = UserStore.getCurrentUser().id;
            if (s[id]?.length !== 32) return;

            // Create new AbortController for this request
            abortControllerRef.current = new AbortController();

            // scroll back to top
            ref.current?.containerRef?.current
                ?.closest("#gif-picker-tab-panel")
                ?.querySelector("[class|=\"content\"]")
                ?.firstElementChild?.scrollTo(0, 0);

            try {
                // Build comma separated list of model names with >0 weight from dynamic modelWeights
                const modelWeights = getModelWeights();
                const models = Object.entries(modelWeights).filter(([, w]) => w > 0).map(([name]) => name);
                const modelsStr = models.join(",");
                const response = await fetch(`${settings.store.api_url}/${s[id]}/search?text=${encodeURIComponent(debouncedQuery)}&models=${encodeURIComponent(modelsStr)}&k=10000`, {
                    signal: abortControllerRef.current.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                // Map model names returned by the API to weights from our settings
                const weights: Record<string, number> = {};

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

                // modelResults keys may be model names or numeric ids; try to map them to our modelWeights
                for (const modelId of Object.keys(modelResults)) {
                    // prefer direct name match
                    if (modelWeights[modelId] !== undefined) {
                        weights[modelId] = modelWeights[modelId];
                    } else {
                        // fallback: try case-insensitive match
                        const found = Object.keys(modelWeights).find(k => k.toLowerCase() === modelId.toLowerCase());
                        if (found) weights[modelId] = modelWeights[found];
                        else weights[modelId] = 0.5; // default
                    }
                }

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
            size="md"
            className=""
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
