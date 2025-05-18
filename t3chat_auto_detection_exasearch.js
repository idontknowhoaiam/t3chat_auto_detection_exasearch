// ==UserScript==
// @name         t3.chat Exa Search
// @namespace    http://tampermonkey.net/
// @version      0.5.3 // Incrementing version for consolidated changes
// @description  Calls Exa API on t3.chat based on AI decision and provides configurable search parameters.
// @match        https://t3.chat/*
// @match        https://beta.t3.chat/*
// @match        https://beta.t3.chat/chat/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.exa.ai
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(async function() {
    'use strict';

    console.log('[T3CHAT-EXA-SCRIPT] IIFE execution started (v0.5.3).');

    const SCRIPT_NAME = "t3.chat Inject Search Toggle (with Exa API)";
    const SCRIPT_VERSION = "0.5.3";
    let debugMode = true; // Default, will be overwritten by GM_getValue in main

    const Logger = {
        log: (...args) => {
            if (debugMode) console.log(`[${SCRIPT_NAME}]`, ...args);
        },
        error: (...args) => {
            console.error(`[${SCRIPT_NAME}-ERROR]`, ...args);
        }
    };

    console.log('[T3CHAT-EXA-SCRIPT] Logger initialized.');

    const DEFAULT_EXA_NUM_RESULTS = 5;
    const DEFAULT_EXA_SUBPAGES = 2;
    const DEFAULT_EXA_LINKS = 3;
    const DEFAULT_EXA_IMAGE_LINKS = 0;

    const GM_STORAGE_KEYS = {
        DEBUG: 'debug',
        EXA_API_KEY: 'exaApiKey',
        EXA_NUM_RESULTS: 'exaNumResults',
        EXA_SUBPAGES: 'exaSubpages',
        EXA_LINKS: 'exaLinks',
        EXA_IMAGE_LINKS: 'exaImageLinks'
    };
    const API_CONFIG = {
        exaEndpoint: 'https://api.exa.ai/search',
        apiRequestTimeout: 60000
    };

    const UI_IDS = {
        styleElement: 't3chat-search-style',
        apiKeyModal: 'exa-key-modal',
        apiKeyModalContent: 'exa-key-modal-content',
        apiKeyModalHeader: 'exa-key-modal-header',
        apiKeyModalDescription: 'exa-key-modal-description',
        apiKeyInput: 'exa-key-input',
        apiKeyShowCheckbox: 'exa-key-show',
        apiKeyShowLabelContainer: 'exa-key-show-label-container',
        apiKeySaveButton: 'exa-key-save',
        searchToggle: 'search-toggle'
    };
    const CSS_CLASSES = {
        button: "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 disabled:cursor-not-allowed hover:bg-muted/40 hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-foreground/50 px-3 text-xs -mb-1.5 h-auto gap-2 rounded-full border border-solid border-secondary-foreground/10 py-1.5 pl-2 pr-2.5 text-muted-foreground",
        searchToggleLoading: 'loading',
        searchToggleOn: 'on'
    };

    let exaApiKey = null;
    let exaNumResults = DEFAULT_EXA_NUM_RESULTS;
    let exaSubpages = DEFAULT_EXA_SUBPAGES;
    let exaLinks = DEFAULT_EXA_LINKS;
    let exaImageLinks = DEFAULT_EXA_IMAGE_LINKS;

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }
    const LaTeXProcessor = {
        map: [
            { pattern: /(\d+)(?:\\,)?(?:\^)?\circ\mathrm{C}/g, replacement: '$1°C' },
            { pattern: /(\d+)(?:\\,)?(?:\^)?\circ\mathrm{F}/g, replacement: '$1°F' },
            { pattern: /(\d+)(?:\\,)?(?:\^)?\circ/g, replacement: '$1°' },
            { pattern: /\times/g, replacement: '×' },
            { pattern: /\div/g, replacement: '÷' },
            { pattern: /\pm/g, replacement: '±' },
            { pattern: /\sqrt{([^}]+)}/g, replacement: '√($1)' },
            { pattern: /\frac{([^}]+)}{([^}]+)}/g, replacement: '$1/$2' },
            { pattern: /\mathrm{([^}]+)}/g, replacement: '$1' },
            { pattern: /\text(?:bf)?{([^}]+)}/g, replacement: '$1' },
            { pattern: /\left\(/g, replacement: '(' },
            { pattern: /\right\)/g, replacement: ')' },
            { pattern: /\,/g, replacement: ' ' }, // Note: might be too aggressive for general text
            { pattern: /\%/g, replacement: '%' },
        ],
        process: function(text) {
            return text
                ? this.map.reduce((t, { pattern, replacement }) => t.replace(pattern, replacement), text)
                : text;
        }
    };

    let SELECTORS = {}; // Populated in main()

    const StyleManager = {
        injectGlobalStyles: () => {
            if (document.getElementById(UI_IDS.styleElement)) return;
            const styleEl = document.createElement('style');
            styleEl.id = UI_IDS.styleElement;
            styleEl.textContent = `
              #${UI_IDS.searchToggle}.${CSS_CLASSES.searchToggleLoading} { opacity: 0.8; /* Slightly less dim for icon visibility */ }
              #${UI_IDS.searchToggle}.${CSS_CLASSES.searchToggleLoading} svg.lucide-globe {
                animation: globe-spin 1.5s linear infinite;
              }
              @keyframes globe-spin {
                from { transform: scaleX(-1) rotate(0deg); } /* Maintain existing horizontal flip */
                to { transform: scaleX(-1) rotate(-360deg); }   /* Rotate clockwise */
              }
              #${UI_IDS.searchToggle} { position: relative; overflow: hidden; transition: color 0.3s ease; }
              #${UI_IDS.searchToggle}::before { content: ''; position: absolute; inset: 0; background-color: rgba(219,39,119,0.15); transform: scaleX(0); transform-origin: left; transition: transform 0.3s ease; z-index:-1; }
              #${UI_IDS.searchToggle}.${CSS_CLASSES.searchToggleOn}::before { transform: scaleX(1); }
              #${UI_IDS.searchToggle} svg { transition: transform 0.3s ease; }
              #${UI_IDS.searchToggle}.${CSS_CLASSES.searchToggleOn} svg { transform: rotate(360deg); }
              #${UI_IDS.apiKeyModal} { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 9999; }
              #${UI_IDS.apiKeyModalContent} { background: #1c1c1e; padding: 24px; border-radius: 12px; width: 360px; box-sizing: border-box; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
              #${UI_IDS.apiKeyModalHeader} { display: flex; align-items: center; margin-bottom: 20px; }
              #${UI_IDS.apiKeyModalHeader} > div:first-child { color: #c62a88; margin-right: 12px; }
              #${UI_IDS.apiKeyModalHeader} > div:last-child { font-size: 22px; font-weight: 600; color: #fff; }
              #${UI_IDS.apiKeyModalDescription} { color: #999; font-size: 14px; margin-bottom: 16px; }
              #${UI_IDS.apiKeyInput} { width: 100%; padding: 12px; margin-bottom: 16px; box-sizing: border-box; background: #2a2a2c; color: #fff; border: 1px solid #333; border-radius: 6px; outline: none; font-size: 14px; }
              #${UI_IDS.apiKeyShowLabelContainer} { display: flex; align-items: center; margin-bottom: 20px; color: #ccc; }
              #${UI_IDS.apiKeyShowCheckbox} { margin-right: 8px; accent-color: #c62a88; }
              #${UI_IDS.apiKeyShowLabelContainer} label { font-size: 14px; }
              #${UI_IDS.apiKeySaveButton} { width: 100%; padding: 12px; background: #a02553; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 15px; font-weight: 500; transition: all 0.2s ease; }
              #${UI_IDS.apiKeySaveButton}:hover { background: #c62a88; }
            `;
            document.head.appendChild(styleEl);
            Logger.log("Global styles injected.");
        }
    };

    const ApiKeyModal = {
        _isShown: false,
        show: () => {
            if (document.getElementById(UI_IDS.apiKeyModal) || ApiKeyModal._isShown) return;
            ApiKeyModal._isShown = true;
            const wrapper = document.createElement('div');
            wrapper.id = UI_IDS.apiKeyModal;
            wrapper.innerHTML = `
              <div id="${UI_IDS.apiKeyModalContent}">
                <div id="${UI_IDS.apiKeyModalHeader}">
                  <div><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg></div>
                  <div>Enter Exa API Key</div>
                </div>
                <div id="${UI_IDS.apiKeyModalDescription}">Set your API Key to enable web search functionality.</div>
                <input id="${UI_IDS.apiKeyInput}" type="password" placeholder="Enter your API Key" />
                <div id="${UI_IDS.apiKeyShowLabelContainer}">
                  <input id="${UI_IDS.apiKeyShowCheckbox}" type="checkbox" />
                  <label for="${UI_IDS.apiKeyShowCheckbox}">Show API Key</label>
                </div>
                <button id="${UI_IDS.apiKeySaveButton}">Save Settings</button>
              </div>`;
            document.body.appendChild(wrapper);
            ApiKeyModal._attachEventListeners(wrapper);
            Logger.log("API Key modal shown.");
        },
        _attachEventListeners: (modalElement) => {
            const keyInput = modalElement.querySelector(`#${UI_IDS.apiKeyInput}`);
            const showCheckbox = modalElement.querySelector(`#${UI_IDS.apiKeyShowCheckbox}`);
            const saveButton = modalElement.querySelector(`#${UI_IDS.apiKeySaveButton}`);

            showCheckbox.addEventListener('change', (e) => {
                keyInput.type = e.target.checked ? 'text' : 'password';
            });

            saveButton.addEventListener('click', async () => {
                const key = keyInput.value.trim();
                if (key) {
                    await GM_setValue(GM_STORAGE_KEYS.EXA_API_KEY, key);
                    exaApiKey = key;
                    Logger.log("API Key saved.");
                    modalElement.remove();
                    ApiKeyModal._isShown = false;
                    location.reload();
                } else {
                    alert('API Key cannot be empty');
                }
            });
        }
    };

    const ExaAPI = {
        call: async (prompt) => {
            if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
                Logger.error("callExa: Invalid prompt");
                return null;
            }
            if (!exaApiKey) {
                Logger.error("callExa: Exa API Key is not set.");
                ApiKeyModal.show();
                return null;
            }
            const requestBody = {
                query: prompt,
                type: "auto",
                numResults: exaNumResults,
                contents: {
                    text: { includeHtmlTags: false },
                    livecrawl: "always",
                    summary: {},
                    subpages: exaSubpages,
                    extras: { links: exaLinks, imageLinks: exaImageLinks }
                }
            };
            Logger.log("Calling Exa API (/search) with prompt:", prompt, "Request body:", requestBody);
            return new Promise((resolve) => {
                let isResolved = false;
                const req = GM_xmlhttpRequest({
                    method: "POST", url: API_CONFIG.exaEndpoint,
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${exaApiKey}` },
                    data: JSON.stringify(requestBody),
                    onload(res) {
                        if (isResolved) return; clearTimeout(timeoutId); isResolved = true;
                        let data; try { data = JSON.parse(res.responseText); } catch (e) {
                            Logger.error("Failed to parse Exa response JSON:", e, "\nOriginal response:", res.responseText?.substring(0, 500) + "...");
                            return resolve(null);
                        }
                        if (res.status >= 200 && res.status < 300 && data && Array.isArray(data.results)) {
                            Logger.log(`Exa API raw response (object, click to expand 'results' array):`, data);
                             // Logger.log(`Exa API raw response (JSON string):`, JSON.stringify(data, null, 2)); // Often too verbose
                            if (data.results.length === 0) {
                                Logger.log("Exa API returned 0 results."); resolve(null);
                            } else {
                                let combinedText = "";
                                for (const result of data.results) {
                                    if (result.title) combinedText += `Title: ${result.title}\n`;
                                    if (result.url) combinedText += `URL: ${result.url}\n`;
                                    if (result.text) combinedText += `Text: ${result.text}\n`;
                                    if (result.summary) combinedText += `Summary: ${result.summary}\n`;
                                    combinedText += '---\n';
                                }
                                resolve(LaTeXProcessor.process(combinedText.trim()));
                            }
                        } else { Logger.error("Exa API error or unexpected structure for /search:", res.status, data); resolve(null); }
                    },
                    onerror(err) { if (isResolved) return; clearTimeout(timeoutId); Logger.error("Exa API request failed:", err); isResolved = true; resolve(null); },
                    ontimeout() { if (isResolved) return; isResolved = true; Logger.error("Exa API request timed out (native timeout)."); resolve(null); }
                });
                const timeoutId = setTimeout(() => {
                    if (isResolved) return; isResolved = true;
                    if (req && typeof req.abort === 'function') req.abort();
                    Logger.error("Exa API request timed out (custom timeout)."); resolve(null);
                }, API_CONFIG.apiRequestTimeout);
            });
        }
    };

    const UIManager = {
        searchToggleButton: null,
        _createSearchToggleButton: async () => {
            const btn = document.createElement("button");
            btn.id = UI_IDS.searchToggle; btn.type = "button";
            btn.setAttribute("aria-label", "Enable search"); btn.setAttribute("data-state", "closed");
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-globe h-4 w-4 scale-x-[-1]"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>Search`;
            btn.className = CSS_CLASSES.button; btn.dataset.mode = "off";
            btn.addEventListener("click", async () => {
                if (!exaApiKey) { exaApiKey = await GM_getValue(GM_STORAGE_KEYS.EXA_API_KEY); }
                if (!exaApiKey) { ApiKeyModal.show(); return; }
                const isOn = btn.classList.toggle(CSS_CLASSES.searchToggleOn);
                btn.setAttribute("aria-label", isOn ? "Disable search" : "Enable search");
                btn.setAttribute("data-state", isOn ? "open" : "closed");
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow.t3ChatSearch) {
                    unsafeWindow.t3ChatSearch.needSearch = isOn;
                    // Reset workflow if toggled off, or to ensure clean state if toggled on
                    unsafeWindow.t3ChatSearch.searchWorkflowState = null;
                    unsafeWindow.t3ChatSearch.originalUserQuery = null;
                    unsafeWindow.t3ChatSearch.keywordsFromAI = null;
                    if (!isOn) { // If toggled OFF, ensure spinner stops
                         UIManager.updateSearchToggleLoadingState(false);
                    }
                }
                Logger.log(`Search toggle set to: ${isOn}. Workflow state reset.`);
            });
            return btn;
        },
        injectSearchToggle: async () => {
            const justifyDiv = document.querySelector(SELECTORS.justifyDiv);
            if (!justifyDiv) { Logger.log("❌ justifyDiv not found for search toggle injection."); return false; }
            const modelTempSection = justifyDiv.querySelector(SELECTORS.modelTempSection);
            if (!modelTempSection) { Logger.log("❌ modelTempSection not found."); return false; }
            const mlGroup = modelTempSection.querySelector(SELECTORS.mlGroup);
            if (!mlGroup) { Logger.log("❌ mlGroup not found. Selector was:", SELECTORS.mlGroup); return false; }
            const existingBtn = mlGroup.querySelector(`#${UI_IDS.searchToggle}`);
            if (existingBtn) {
                if (mlGroup.lastElementChild !== existingBtn) { mlGroup.appendChild(existingBtn); }
                UIManager.searchToggleButton = existingBtn; return true;
            }
            UIManager.searchToggleButton = await UIManager._createSearchToggleButton();
            mlGroup.appendChild(UIManager.searchToggleButton);
            Logger.log("✅ SearchToggle injected."); return true;
        },
        updateSearchToggleLoadingState: (isLoading) => {
            if (UIManager.searchToggleButton) {
                if (isLoading) {
                    UIManager.searchToggleButton.classList.add(CSS_CLASSES.searchToggleLoading);
                } else {
                    UIManager.searchToggleButton.classList.remove(CSS_CLASSES.searchToggleLoading);
                }
            }
        }
    };

    const FetchInterceptor = {
        originalFetch: null,
        init: () => {
            if (typeof unsafeWindow === 'undefined') { Logger.error("unsafeWindow is not available. Fetch interception disabled."); return; }
            const w = unsafeWindow;
            w.t3ChatSearch = w.t3ChatSearch || { needSearch: false, searchWorkflowState: null, originalUserQuery: null, keywordsFromAI: null };
            FetchInterceptor.originalFetch = w.fetch.bind(w);
            w.fetch = async function(input, initOptions) {
                if (!initOptions?.body) { return FetchInterceptor.originalFetch.call(this, input, initOptions); }
                let data; try { data = JSON.parse(initOptions.body); } catch { return FetchInterceptor.originalFetch.call(this, input, initOptions); }
                if (!Array.isArray(data.messages)) { return FetchInterceptor.originalFetch.call(this, input, initOptions); }
                const messages = data.messages; const lastIdx = messages.length - 1;
                if (lastIdx < 0 || messages[lastIdx]?.role !== 'user') { return FetchInterceptor.originalFetch.call(this, input, initOptions); }
                const currentPrompt = messages[lastIdx]?.content;
                if (typeof currentPrompt !== 'string') { return FetchInterceptor.originalFetch.call(this, input, initOptions); }

                if (w.t3ChatSearch.needSearch) {
                    // Start loading spinner only if we are initiating the AI decision step
                    if (!w.t3ChatSearch.searchWorkflowState) {
                        UIManager.updateSearchToggleLoadingState(true);
                    }

                    if (w.t3ChatSearch.searchWorkflowState === WORKFLOW_STATE.AWAITING_RESULTS) {
                        const keywords = w.t3ChatSearch.keywordsFromAI;
                        Logger.log(`Fetch intercepted for Exa search with keywords: ${keywords}`);
                        const searchRes = await ExaAPI.call(keywords);
                        if (searchRes) {
                            const historySegment = w.t3ChatSearch.conversationHistoryPriorToQuery ? `Conversation history prior to this query:\n${w.t3ChatSearch.conversationHistoryPriorToQuery}\n\n` : "";
                            const searchInstruction = `${historySegment}Latest user query: "${w.t3ChatSearch.originalUserQuery}"\nExa search keywords: "${keywords}"\n\nWeb search results:\n${searchRes}\n\nPlease answer the user's query using the above conversation history, latest query, and web search results.`;
                            messages[lastIdx].content = searchInstruction;
                        } else {
                            Logger.log("No Exa search results, or search failed. Informing AI.");
                            messages[lastIdx].content = `Original Query: "${w.t3ChatSearch.originalUserQuery}"\nWeb search for keywords "${keywords}" was attempted but failed or returned no results. Please answer the original query to the best of your ability.`;
                        }
                        initOptions.body = JSON.stringify(data);
                        Logger.log(searchRes ? "Exa search results prepended with simplified preamble." : "Informed AI about failed search.");
                        w.t3ChatSearch.searchWorkflowState = null;
                        w.t3ChatSearch.originalUserQuery = null;
                        w.t3ChatSearch.keywordsFromAI = null;
                        UIManager.updateSearchToggleLoadingState(false); // Stop spinner after Exa cycle
                    } else if (!w.t3ChatSearch.searchWorkflowState) { // Starting a new cycle
                        w.t3ChatSearch.originalUserQuery = currentPrompt;

                        const allInputMessages = data.messages; // This array ends with the current user prompt
                        if (allInputMessages && allInputMessages.length > 1) {
                            // History includes all messages *except* the last one (currentPrompt)
                            w.t3ChatSearch.conversationHistoryPriorToQuery = allInputMessages.slice(0, -1).map(msg => {
                                let roleDisplay = msg.role === 'user' ? 'User' : (msg.role === 'assistant' ? 'Assistant' : msg.role);
                                return `${roleDisplay}: ${msg.content}`;
                            }).join('\n');
                        } else {
                            w.t3ChatSearch.conversationHistoryPriorToQuery = null; // No prior history
                        }

                        // For the decisionPrompt, we need the *complete* history *including* the currentPrompt
                        let fullDialogForAIDecision = "";
                        if (allInputMessages && allInputMessages.length > 0) {
                            fullDialogForAIDecision = allInputMessages.map(msg => {
                                let roleDisplay = msg.role === 'user' ? 'User' : (msg.role === 'assistant' ? 'Assistant' : msg.role);
                                // Ensure newlines in content are escaped for the prompt string literal
                                const content = msg.content ? msg.content.replace(/\n/g, '\\n') : '';
                                return `${roleDisplay}: ${content}`;
                            }).join('\n');
                        } else {
                            // This case should ideally not happen if currentPrompt is valid
                            const safeCurrentPrompt = currentPrompt ? currentPrompt.replace(/\n/g, '\\n') : '';
                            fullDialogForAIDecision = `User: ${safeCurrentPrompt}`;
                        }

                        const decisionPrompt = `Please analyze the following full conversation history:\n${fullDialogForAIDecision}\n\nBased on the above dialogue, determine whether the user's latest query requires a web search to answer effectively.\nIf a web search is required, reply ONLY with: SEARCH_KEYWORDS: [comma-separated keywords]\nIf no web search is needed, provide a direct answer to the user's query, and ensure your reply begins with "NO_SEARCH_NEEDED: " (with a space after the colon). For example: "NO_SEARCH_NEEDED: It is 3 PM in London now."`;

                        messages[lastIdx].content = decisionPrompt;
                        initOptions.body = JSON.stringify(data);
                        w.t3ChatSearch.searchWorkflowState = WORKFLOW_STATE.AWAITING_DECISION;
                        Logger.log("Fetch intercepted: Sending full dialog to AI for search decision and keywords. Decision prompt snapshot (check console for full):", decisionPrompt.substring(0, 200) + "...");
                    }
                    // If searchWorkflowState is 'awaitingAiDecision', the spinner is already on.
                    // The observer will turn it off if NO_SEARCH_NEEDED, or it continues to Exa.
                } else {
                     UIManager.updateSearchToggleLoadingState(false); // Ensure spinner is off if toggle is off
                }
                return FetchInterceptor.originalFetch.call(this, input, initOptions);
            };
            Logger.log("Fetch interceptor initialized with new workflow.");
        }
    };

    const ResponseObserver = {
        observer: null,
        _debouncedProcessAiResponse: null,
        init: (containerElement) => {
            if (!containerElement) { Logger.error("[ResponseObserver.init] No containerElement provided."); return; }
            if (ResponseObserver.observer) { Logger.log("[ResponseObserver.init] Disconnecting existing observer."); ResponseObserver.observer.disconnect(); }

            ResponseObserver._debouncedProcessAiResponse = debounce((pElement) => {
                if (!pElement || typeof unsafeWindow === 'undefined' || !unsafeWindow.t3ChatSearch || unsafeWindow.t3ChatSearch.searchWorkflowState !== WORKFLOW_STATE.AWAITING_DECISION) {
                    return;
                }
                const aiResponseText = pElement.textContent.trim();
                Logger.log('[ResponseObserver._debouncedProcessAiResponse] Debounced execution. Full text:', aiResponseText);

                const PREFIX = "SEARCH_KEYWORDS:";
                if (aiResponseText.includes(PREFIX)) {
                    // Don't turn off spinner here, it will be turned off in FetchInterceptor after Exa results
                    let contentAfterPrefix = aiResponseText.substring(aiResponseText.indexOf(PREFIX) + PREFIX.length).trim();
                    let keywordsToSubmit = null;

                    if (contentAfterPrefix.startsWith("[")) {
                        if (contentAfterPrefix.includes("]") && contentAfterPrefix.lastIndexOf("]") > contentAfterPrefix.indexOf("[")) {
                            const potentialKeywords = contentAfterPrefix.substring(contentAfterPrefix.indexOf("[") + 1, contentAfterPrefix.lastIndexOf("]")).trim();
                            if (potentialKeywords) { keywordsToSubmit = potentialKeywords; }
                        }
                    } else if (contentAfterPrefix) {
                        keywordsToSubmit = contentAfterPrefix;
                    }

                    if (keywordsToSubmit) {
                        if (keywordsToSubmit.includes("NO_SEARCH_NEEDED:")) {
                            keywordsToSubmit = keywordsToSubmit.split("NO_SEARCH_NEEDED:")[0].trim();
                        }
                        if (keywordsToSubmit) {
                            Logger.log('[ResponseObserver._debouncedProcessAiResponse] Final Extracted keywords:', keywordsToSubmit);
                            unsafeWindow.t3ChatSearch.keywordsFromAI = keywordsToSubmit;
                            unsafeWindow.t3ChatSearch.searchWorkflowState = WORKFLOW_STATE.AWAITING_RESULTS;
                            ResponseObserver.submitKeywords(keywordsToSubmit);
                        } else {
                             Logger.log('[ResponseObserver._debouncedProcessAiResponse] Keywords became empty after NO_SEARCH_NEEDED strip. Resetting state.');
                             UIManager.updateSearchToggleLoadingState(false); // Stop spinner
                             unsafeWindow.t3ChatSearch.searchWorkflowState = null;
                             unsafeWindow.t3ChatSearch.originalUserQuery = null;
                        }
                    } else {
                        Logger.log('[ResponseObserver._debouncedProcessAiResponse] No valid keywords extracted after debounce. Resetting state.');
                        UIManager.updateSearchToggleLoadingState(false); // Stop spinner
                        unsafeWindow.t3ChatSearch.searchWorkflowState = null;
                        unsafeWindow.t3ChatSearch.originalUserQuery = null;
                    }
                } else if (aiResponseText.includes("NO_SEARCH_NEEDED:")) {
                    UIManager.updateSearchToggleLoadingState(false); // Stop spinner
                    Logger.log('[ResponseObserver._debouncedProcessAiResponse] NO_SEARCH_NEEDED detected after debounce. Resetting state.');
                    unsafeWindow.t3ChatSearch.searchWorkflowState = null;
                    unsafeWindow.t3ChatSearch.originalUserQuery = null;
                }
            }, 750); // 750ms debounce

            ResponseObserver.observer = new MutationObserver(ResponseObserver.handleMutations);
            ResponseObserver.observer.observe(containerElement, { childList: true, subtree: true, characterData: true });
            Logger.log("[ResponseObserver.init] Observer initialized with debounced AI response processing.");
        },
        handleMutations: (mutationsList) => {
            if (typeof unsafeWindow === 'undefined' || !unsafeWindow.t3ChatSearch || unsafeWindow.t3ChatSearch.searchWorkflowState !== WORKFLOW_STATE.AWAITING_DECISION) {
                return;
            }

            for (const mutation of mutationsList) {
                let targetParagraph = null;

                if (mutation.type === 'characterData') {
                    const pEl = mutation.target.parentElement;
                    if (pEl && (pEl.matches('div[role="article"][aria-label="Assistant message"] p') || pEl.matches('div[role="article"][aria-label="Assistant message"] div.prose > p'))) {
                        targetParagraph = pEl;
                    }
                } else if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const aiMessageElement = node.querySelector('div[role="article"][aria-label="Assistant message"] p, div[role="article"][aria-label="Assistant message"] div.prose > p');
                            if (aiMessageElement) {
                                targetParagraph = aiMessageElement;
                            }
                        }
                    });
                }

                if (targetParagraph) {
                    const currentText = targetParagraph.textContent.trim();
                    if (currentText.includes("SEARCH_KEYWORDS:") || currentText.includes("NO_SEARCH_NEEDED:")) {
                        Logger.log(`[ResponseObserver.handleMutations] Detected keyword phrase in: ${mutation.type}. Scheduling debounce for:`, targetParagraph);
                        ResponseObserver._debouncedProcessAiResponse(targetParagraph);
                    }
                }
            }
        },
        submitKeywords: (keywords) => {
            Logger.log(`[ResponseObserver.submitKeywords] Called with keywords: "${keywords}"`);
            // Use cached selector if available
            let chatInputField = DOMCache.chatInputSelector
                ? document.querySelector(DOMCache.chatInputSelector)
                : document.querySelector(SELECTORS.chatInput);

            Logger.log(`[ResponseObserver.submitKeywords] Final chatInputField found: ${!!chatInputField}`);

            if (chatInputField) {
                chatInputField.focus();
                Logger.log(`[ResponseObserver.submitKeywords] document.activeElement after focus: ${document.activeElement?.id || document.activeElement?.tagName || document.activeElement}`);

                const submissionText = `Exa Search (AI Decision: YES). Keywords: ${keywords}`;
                chatInputField.value = submissionText;

                chatInputField.dispatchEvent(new Event('input', { bubbles: true, composed: true, cancelable: true }));
                chatInputField.dispatchEvent(new Event('change', { bubbles: true, composed: true, cancelable: true }));
                Logger.log(`[ResponseObserver.submitKeywords] chatInputField.value after assignment & events: "${submissionText}"`);

                setTimeout(() => {
                    (async () => {
                        Logger.log("[ResponseObserver.submitKeywords] Polling for send button to enable/appear...");
                        const maxAttempts = 25;
                        const delay = 150;
                        let clicked = false;
                        for (let attempt = 0; attempt < maxAttempts; attempt++) {
                            // Use cached send button selector if available
                            const btn = (DOMCache.sendButtonSelector
                                ? document.querySelector(DOMCache.sendButtonSelector)
                                : document.querySelector(SELECTORS.sendButton))
                                || document.querySelector('button[type="submit"]');
                            if (btn && !btn.disabled) {
                                const svgPath = btn.querySelector('svg path[d^="m5 12"]');
                                if (svgPath) {
                                    btn.click();
                                    Logger.log("[ResponseObserver.submitKeywords] Clicked send button (verified with icon):", btn);
                                    clicked = true;
                                    break;
                                } else {
                                    Logger.log("[ResponseObserver.submitKeywords] Found a submit button, but icon doesn't match send. Skipping this one for now.", btn);
                                }
                            }
                            if (attempt < maxAttempts -1) {
                                Logger.log(`[ResponseObserver.submitKeywords] Send button not ready (attempt ${attempt + 1}/${maxAttempts}). Waiting ${delay}ms`);
                            }
                            await new Promise(res => setTimeout(res, delay));
                        }
                        if (!clicked) {
                            const anySubmitBtn = document.querySelector('button[type="submit"]:not(:disabled)');
                            if (anySubmitBtn) {
                                anySubmitBtn.click();
                                Logger.log("[ResponseObserver.submitKeywords] Clicked ANY enabled submit button as a final fallback:", anySubmitBtn);
                                clicked = true;
                            }
                        }

                        if (!clicked) {
                            Logger.error("[ResponseObserver.submitKeywords] Failed to find an enabled send button after polling and fallback.");
                            UIManager.updateSearchToggleLoadingState(false); // Ensure spinner off on failure
                            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.t3ChatSearch) {
                                unsafeWindow.t3ChatSearch.searchWorkflowState = null;
                                unsafeWindow.t3ChatSearch.keywordsFromAI = null;
                            }
                        }
                    })();
                }, 150);
            } else {
                Logger.error("[ResponseObserver.submitKeywords] Chat input field NOT found. Cannot submit keywords.");
                UIManager.updateSearchToggleLoadingState(false); // Ensure spinner off on failure
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow.t3ChatSearch) {
                    unsafeWindow.t3ChatSearch.searchWorkflowState = null;
                    unsafeWindow.t3ChatSearch.keywordsFromAI = null;
                }
            }

            // Fallback to any textarea inside form if primary selector not found
            if (!chatInputField) {
                const form = document.querySelector('form');
                if (form) {
                    chatInputField = form.querySelector('textarea');
                    Logger.log(`[ResponseObserver.submitKeywords] Fallback for chatInput: ${!!chatInputField}`);
                }
            }
        }
    };

    const DOMCorrector = {
        _processNodeAndItsTextDescendants: function(node) {
            if (!node) return false; let processed = false;
            if (node.nodeType === Node.TEXT_NODE) {
                const orig = node.textContent; const proc = LaTeXProcessor.process(orig);
                if (proc !== orig) { node.textContent = proc; processed = true; }
            } else if (node.nodeType === Node.ELEMENT_NODE && node.hasChildNodes()) {
                const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let textNode;
                while (textNode = walker.nextNode()) {
                    const origContent = textNode.textContent; const procContent = LaTeXProcessor.process(origContent);
                    if (procContent !== origContent) { textNode.textContent = procContent; processed = true; }
                }
            } return processed;
        },
        _fixMathInChatInternal: (mutations) => {
            let changesMadeOverall = false;
            if (!mutations || mutations.length === 0) {
                const logContainer = document.querySelector(SELECTORS.chatLogContainer);
                const container = logContainer || document.querySelector(SELECTORS.mainContentArea) || document.querySelector(SELECTORS.chatArea);
                if (container && DOMCorrector._processNodeAndItsTextDescendants(container)) { changesMadeOverall = true; }
            } else {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        for (const addedNode of mutation.addedNodes) { if (DOMCorrector._processNodeAndItsTextDescendants(addedNode)) changesMadeOverall = true; }
                    } else if (mutation.type === 'characterData') { if (DOMCorrector._processNodeAndItsTextDescendants(mutation.target)) changesMadeOverall = true; }
                }
            }
        },
        fixMathInChat: null,
        observeChatChanges: () => {
            DOMCorrector.fixMathInChat = debounce(DOMCorrector._fixMathInChatInternal, 250);
            const containerToObserve = document.querySelector(SELECTORS.chatLogContainer) || document.querySelector(SELECTORS.mainContentArea) || document.body;
            if (!containerToObserve) { Logger.error("DOMCorrector: No suitable container to observe for math changes."); return; }
            const observer = new MutationObserver((mutationsList) => { DOMCorrector.fixMathInChat(mutationsList); });
            observer.observe(containerToObserve, { subtree: true, childList: true, characterData: true });
            DOMCorrector._fixMathInChatInternal(null);
            Logger.log("Chat observer for math corrections initialized.");
        }
    };

    const MenuCommands = {
        init: async () => {
            GM_registerMenuCommand('Reset Exa API Key', async () => {
                await GM_setValue(GM_STORAGE_KEYS.EXA_API_KEY, ''); exaApiKey = null;
                Logger.log("Exa API Key reset. Reloading."); location.reload();
            });
            GM_registerMenuCommand('Toggle debug logs', async () => {
                const newDebugVal = !(await GM_getValue(GM_STORAGE_KEYS.DEBUG, true));
                await GM_setValue(GM_STORAGE_KEYS.DEBUG, newDebugVal);
                debugMode = newDebugVal;
                alert(`Debug mode set to: ${debugMode}. Reloading page for changes to take full effect if needed.`);
                Logger.log(`Debug mode toggled to: ${debugMode} via menu.`);
            });
            const createNumericConfigCommand = async (storageKey, name, defVal, liveValRef) => {
                const currentStoredVal = await GM_getValue(storageKey, defVal);
                GM_registerMenuCommand(`Set Exa ${name} (Current: ${currentStoredVal}, Default: ${defVal})`, async () => {
                    const promptCurrentValue = await GM_getValue(storageKey, defVal);
                    const newValStr = prompt(`Enter new Exa ${name} (integer, default: ${defVal}):`, promptCurrentValue);
                    if (newValStr !== null) {
                        const parsed = parseInt(newValStr, 10);
                        if (!isNaN(parsed) && parsed >= 0) {
                            await GM_setValue(storageKey, parsed);
                            Logger.log(`Exa ${name} set to: ${parsed}. Reloading.`); location.reload();
                        } else { alert(`Invalid input. Please enter a non-negative integer. ${name} not changed.`); }
                    }
                });
            };
            await createNumericConfigCommand(GM_STORAGE_KEYS.EXA_NUM_RESULTS, "Search Results Count", DEFAULT_EXA_NUM_RESULTS, exaNumResults);
            await createNumericConfigCommand(GM_STORAGE_KEYS.EXA_SUBPAGES, "Subpages Count", DEFAULT_EXA_SUBPAGES, exaSubpages);
            await createNumericConfigCommand(GM_STORAGE_KEYS.EXA_LINKS, "Links Count", DEFAULT_EXA_LINKS, exaLinks);
            await createNumericConfigCommand(GM_STORAGE_KEYS.EXA_IMAGE_LINKS, "Image Links Count", DEFAULT_EXA_IMAGE_LINKS, exaImageLinks);
            Logger.log("Menu commands registered.");
        }
    };

    // Workflow states for search process
    const WORKFLOW_STATE = {
        NONE: null,
        AWAITING_DECISION: 'awaitingAiDecision',
        AWAITING_RESULTS: 'awaitingExaResults'
    };
    // Cache commonly used DOM selectors
    const DOMCache = {
        chatInputSelector: '',
        sendButtonSelector: '',
        chatLogContainerSelector: '',
        justifyDivSelector: '',
        mlGroupSelector: ''
    };

    async function main() {
        console.log('[T3CHAT-EXA-SCRIPT] main() function started.');

        SELECTORS = {
            justifyDiv: 'div.mt-2.flex-row-reverse.justify-between',
            modelTempSection: 'div.flex.flex-col',
            mlGroup: `div.${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape('ml-[-7px]') : 'ml-\\[-7px\\]'}`,
            chatLogContainer: 'div[role="log"][aria-label="Chat messages"]',
            mainContentArea: 'main',
            chatArea: '.chat', // Generic fallback, prefer chatLogContainer
            chatInput: 'textarea#chat-input',
            sendButton: 'button[aria-label="Send message"][type="submit"]'
        };
        // Cache selectors for improved performance
        DOMCache.chatInputSelector = SELECTORS.chatInput;
        DOMCache.sendButtonSelector = SELECTORS.sendButton;
        DOMCache.chatLogContainerSelector = SELECTORS.chatLogContainer;
        DOMCache.justifyDivSelector = SELECTORS.justifyDiv;
        DOMCache.mlGroupSelector = SELECTORS.mlGroup;
        console.log('[T3CHAT-EXA-SCRIPT] SELECTORS defined.');

        try {
            debugMode = await GM_getValue(GM_STORAGE_KEYS.DEBUG, true);
            Logger.log(`[MAIN-TRY] ${SCRIPT_NAME} v${SCRIPT_VERSION} starting. Debug mode (from GM): ${debugMode}`);

            exaApiKey = await GM_getValue(GM_STORAGE_KEYS.EXA_API_KEY);
            if (!exaApiKey) { Logger.log("[MAIN-TRY] Exa API Key not found. Will prompt if search is used."); }
            else { Logger.log("[MAIN-TRY] Exa API Key loaded."); }

            exaNumResults = await GM_getValue(GM_STORAGE_KEYS.EXA_NUM_RESULTS, DEFAULT_EXA_NUM_RESULTS);
            exaSubpages = await GM_getValue(GM_STORAGE_KEYS.EXA_SUBPAGES, DEFAULT_EXA_SUBPAGES);
            exaLinks = await GM_getValue(GM_STORAGE_KEYS.EXA_LINKS, DEFAULT_EXA_LINKS);
            exaImageLinks = await GM_getValue(GM_STORAGE_KEYS.EXA_IMAGE_LINKS, DEFAULT_EXA_IMAGE_LINKS);
            Logger.log(`[MAIN-TRY] Exa API params loaded.`);

            if (typeof unsafeWindow !== 'undefined') {
                unsafeWindow.t3ChatSearch = unsafeWindow.t3ChatSearch || {};
                unsafeWindow.t3ChatSearch.needSearch = unsafeWindow.t3ChatSearch.needSearch || false; // Persist across reloads if already set
                unsafeWindow.t3ChatSearch.searchWorkflowState = null; // Always reset workflow state on load
                unsafeWindow.t3ChatSearch.originalUserQuery = null;
                unsafeWindow.t3ChatSearch.keywordsFromAI = null;
                Logger.log("[MAIN-TRY] unsafeWindow.t3ChatSearch initialized/checked.");
            } else { Logger.warn("[MAIN-TRY] unsafeWindow is undefined."); }

            await MenuCommands.init();
            StyleManager.injectGlobalStyles();
            FetchInterceptor.init();

            const injectionObserverTargetParent = document.querySelector(SELECTORS.justifyDiv)?.parentElement || document.body;
            const injectionObserver = new MutationObserver(async (mutations, obs) => {
                const targetContainer = document.querySelector(SELECTORS.mlGroup);
                if (targetContainer && await UIManager.injectSearchToggle()) { /* UI Toggle Injected */ }
                else if (!targetContainer) { // Fallback if mlGroup not ready
                    const justifyDiv = document.querySelector(SELECTORS.justifyDiv);
                    if (justifyDiv) await UIManager.injectSearchToggle();
                }
            });
            injectionObserver.observe(injectionObserverTargetParent, { childList: true, subtree: true });
            await UIManager.injectSearchToggle(); // Initial attempt

            DOMCorrector.observeChatChanges();

            async function ensureResponseObserverIsInitialized(maxRetries = 20, interval = 500) {
                Logger.log("[MAIN-TRY.ensureResponseObserver] Starting check for chatLogContainer...");
                for (let i = 0; i < maxRetries; i++) {
                    const chatLogContainer = document.querySelector(SELECTORS.chatLogContainer);
                    if (chatLogContainer) {
                        Logger.log(`[MAIN-TRY.ensureResponseObserver] chatLogContainer found after ${i + 1} attempt(s). Initializing ResponseObserver.`);
                        ResponseObserver.init(chatLogContainer); return;
                    }
                    if (i < maxRetries - 1) { Logger.log(`[MAIN-TRY.ensureResponseObserver] chatLogContainer not found (attempt ${i + 1}/${maxRetries}). Waiting ${interval}ms.`); }
                    await new Promise(resolve => setTimeout(resolve, interval));
                }
                Logger.error(`[MAIN-TRY.ensureResponseObserver] Failed to find chatLogContainer after ${maxRetries} retries. ResponseObserver NOT initialized.`);
            }
            ensureResponseObserverIsInitialized();
            Logger.log("[MAIN-TRY] Initialization sequence complete.");

        } catch (e) {
            Logger.error("[MAIN-CATCH-GENERAL] Error during main execution: ", e);
            console.error("[MAIN-CATCH-GENERAL] Full error object:", e);
            if (e && e.stack) {
                 console.error("[MAIN-CATCH-GENERAL] Stack trace:", e.stack);
            }
        }
    }

    function scheduleMain() {
        console.log(`[T3CHAT-EXA-SCRIPT] scheduleMain() called. document.readyState: ${document.readyState}`);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log(`[T3CHAT-EXA-SCRIPT] DOMContentLoaded event fired. Calling main().`);
                main().catch(err => {
                    console.error(`[T3CHAT-EXA-SCRIPT] CRITICAL Unhandled error from main() (DOMContentLoaded):`, err);
                });
            });
        } else {
            console.log(`[T3CHAT-EXA-SCRIPT] DOM already interactive/complete. Calling main() directly.`);
            main().catch(err => {
                console.error(`[T3CHAT-EXA-SCRIPT] CRITICAL Unhandled error from main() (direct call):`, err);
            });
        }
    }

    try {
        console.log('[T3CHAT-EXA-SCRIPT] Attempting to schedule main().');
        scheduleMain();
        console.log('[T3CHAT-EXA-SCRIPT] scheduleMain() call completed.');
    } catch(e) {
        console.error(`[T3CHAT-EXA-SCRIPT] CRITICAL Synchronous error in IIFE:`, e);
    }

})();