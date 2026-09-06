import {JSDOM, ResourceLoader, VirtualConsole} from 'jsdom';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const STATIC_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(
    path.join(STATIC_DIR, 'galene.html'), 'utf8');

const DEFAULT_DEVICES = [
    {deviceId: 'cam1', kind: 'videoinput', label: 'Camera 1', groupId: 'g1'},
    {deviceId: 'cam2', kind: 'videoinput', label: 'Camera 2', groupId: 'g1'},
    {deviceId: 'mic1', kind: 'audioinput', label: 'Microphone 1', groupId: 'g2'},
    {deviceId: 'mic2', kind: 'audioinput', label: 'Microphone 2', groupId: 'g2'},
];

class LocalLoader extends ResourceLoader {
    fetch(url) {
        try {
            const pathname = new URL(url).pathname;
            const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
            if(!rel)
                return null;
            const file = path.join(STATIC_DIR, rel);
            if(!existsSync(file))
                return null;
            return Promise.resolve(Buffer.from(readFileSync(file)));
        } catch(e) {
            return null;
        }
    }
}

/**
 * Records the set of "captured" calls in the tests: every value we need to
 * inspect is stored on the window itself, since we cannot peek at the
 * lexical `let` bindings of the classic scripts.
 */
function installStubs(window, opts) {
    const settings = opts.settings || {};

    window.__errors = [];
    window.__gumCalls = [];
    window.__streams = [];
    window.__gumFailNext = false;

    window.addEventListener('error', (e) => {
        window.__errors.push(e.error || e.message);
    });

    // galene.js start() fetches ".status"; without a token or an
    // auth-portal this lands us on the login screen and never opens a
    // WebSocket.
    window.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => opts.status || {name: 'group1'},
    });

    if(typeof window.matchMedia === 'undefined') {
        window.matchMedia = (query) => ({
            matches: false,
            media: query,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false; },
        });
    }

    window.sessionStorage.setItem('settings', JSON.stringify(settings));

    // Seed localStorage (used by the automatic-login feature) before the
    // scripts run.
    for(const [key, value] of Object.entries(opts.localStorage || {})) {
        try {
            window.localStorage.setItem(key, value);
        } catch(e) {
            // ignore
        }
    }

    let trackSeq = 0;
    let streamSeq = 0;

    window.__makeTrack = function(kind) {
        return {
            kind,
            id: `${kind}-${++trackSeq}`,
            enabled: true,
            muted: false,
            readyState: 'live',
            stop() { this.readyState = 'ended'; },
            clone() {
                return window.__makeTrack(kind);
            },
        };
    };

    window.__makeStream = function(hasAudio, hasVideo) {
        const tracks = [];
        if(hasAudio)
            tracks.push(window.__makeTrack('audio'));
        if(hasVideo)
            tracks.push(window.__makeTrack('video'));
        const stream = {
            id: `stream-${++streamSeq}`,
            active: true,
            getTracks() { return tracks.slice(); },
            getAudioTracks() {
                return tracks.filter((t) => t.kind === 'audio');
            },
            getVideoTracks() {
                return tracks.filter((t) => t.kind === 'video');
            },
            getTrackById() { return null; },
            addTrack() {},
            removeTrack() {},
            stop() {},
        };
        window.__streams.push(stream);
        return stream;
    };

    Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: async (constraints) => {
                window.__gumCalls.push(JSON.parse(
                    JSON.stringify(constraints)));
                if(window.__gumFailNext) {
                    window.__gumFailNext = false;
                    throw new window.DOMException(
                        'Permission denied', 'NotAllowedError');
                }
                return window.__makeStream(
                    !!constraints.audio, !!constraints.video);
            },
            getDisplayMedia: async () => {
                throw new window.DOMException(
                    'Unsupported', 'NotSupportedError');
            },
            enumerateDevices: async () => {
                const devices = opts.devices || DEFAULT_DEVICES;
                return devices.map((d) => ({
                    deviceId: d.deviceId,
                    kind: d.kind,
                    label: d.label,
                    groupId: d.groupId,
                    toJSON() {
                        return {
                            deviceId: d.deviceId,
                            kind: d.kind,
                            label: d.label,
                            groupId: d.groupId,
                        };
                    },
                }));
            },
        },
    });

    // A minimal WebAudio implementation; getByteTimeDomainData fills the
    // buffer with silence so that the meter draws deterministically.
    if(typeof window.AudioContext === 'undefined') {
        window.AudioContext = class {
            createMediaStreamSource() {
                return {connect() {}};
            }
            createAnalyser() {
                return {
                    fftSize: 0,
                    smoothingTimeConstant: 0,
                    connect() {},
                    getByteTimeDomainData(data) {
                        data.fill(128);
                    },
                };
            }
            close() {
                return Promise.resolve();
            }
        };
    }

    // A minimal WebSocket implementation, only installed when requested.
    // jsdom does not implement WebSocket; galene.js calls serverConnect()
    // only when a token is present or when automatic login kicks in.
    // The fake records the URL and never opens, which lets us observe that
    // a connection attempt was made without driving the full protocol.
    if(opts.webSocket) {
        window.WebSocket = class {
            constructor(url) {
                window.__wsCalls = window.__wsCalls || [];
                window.__wsCalls.push(url);
                this.url = url;
                this.readyState = 0;
                this.OPEN = 1;
                this.CONNECTING = 0;
                this.CLOSED = 3;
            }
            send() {}
            close() {
                this.readyState = 3;
            }
        };
    }

    // jsdom's HTMLMediaElement.play() rejects (no real media); the preview
    // code calls play() without awaiting it.
    try {
        Object.defineProperty(
            window.HTMLMediaElement.prototype, 'play', {
                configurable: true,
                value: async function play() {},
            });
        Object.defineProperty(
            window.HTMLMediaElement.prototype, 'pause', {
                configurable: true,
                value: function pause() {},
            });
    } catch(e) {
        // ignore
    }

    // jsdom does not implement a 2D canvas context; provide one so that the
    // preview meter can draw.  startLoginMeter() tolerates a null context,
    // so a failure to override is not fatal.
    try {
        Object.defineProperty(
            window.HTMLCanvasElement.prototype, 'getContext', {
                configurable: true,
                value: function getContext(kind) {
                    if(kind !== '2d')
                        return null;
                    if(!window.__ctx2d) {
                        window.__ctx2d = {
                            fillStyle: '#000',
                            fillRect() {},
                            clearRect() {},
                        };
                    }
                    return window.__ctx2d;
                },
            });
    } catch(e) {
        // ignore: jsdom keeps returning null and the meter is skipped
    }
}

/**
 * @param {unknown} value
 */
export async function waitFor(what, message, timeout = 4000) {
    const deadline = Date.now() + timeout;
    for(;;) {
        if(what())
            return;
        if(Date.now() > deadline) {
            throw new Error(message);
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
    }
}

/**
 * Loads the real galene.html (with the real protocol/settings/filter/
 * camera-test/galene scripts) into jsdom and waits until the login screen
 * is shown, which means start() has run to completion.
 *
 * @param {object} [opts]
 * @param {object} [opts.settings] initial settings for sessionStorage
 * @param {object} [opts.localStorage] initial entries for localStorage
 * @param {Array<{deviceId:string,kind:string,label:string,groupId:string}>} [opts.devices]
 * @param {object} [opts.status] JSON returned by fetch(".status")
 * @param {boolean} [opts.webSocket] install a recording fake WebSocket
 * @param {boolean} [opts.waitLogin] wait for the login screen and the
 *   automatic preview before resolving (default true); set to false when
 *   the page under test auto-logs in and never shows the login screen.
 */
export async function loadApp(opts = {}) {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => {
        opts.onJsdomError && opts.onJsdomError(e);
    });

    const dom = new JSDOM(HTML, {
        url: 'https://galene.test/galene.html',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        resources: new LocalLoader(),
        virtualConsole,
        beforeParse(window) {
            installStubs(window, opts);
        },
    });

    const window = dom.window;

    await new Promise((resolve, reject) => {
        if(window.document.readyState === 'complete') {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            reject(new Error('timeout while loading the page'));
        }, 10000);
        window.addEventListener('load', () => {
            clearTimeout(timer);
            resolve();
        });
    });

    if(opts.waitLogin !== false) {
        await waitFor(
            () => {
                const el = window.document.getElementById('login-container');
                return !!(el && !el.classList.contains('invisible'));
            },
            'login screen did not appear (start() may have failed): ' +
                JSON.stringify(window.__errors));

        // The camera and microphone default to on, so start() begins a live
        // preview as soon as the login screen is shown.  Wait until it has
        // settled so that the initial state is deterministic.
        await waitFor(
            () => {
                const el = window.document.getElementById('login-preview');
                return !!(el && !el.classList.contains('invisible'));
            },
            'auto-preview did not appear (default-on media may have failed): ' +
                JSON.stringify(window.__errors));
    }

    return {
        dom,
        window,
        document: window.document,
        errors: window.__errors,
        gumCalls() { return window.__gumCalls; },
        streams() { return window.__streams; },
        setSettings(obj) {
            window.sessionStorage.setItem('settings', JSON.stringify(obj));
        },
        failNextGum() { window.__gumFailNext = true; },
        close() { dom.window.close(); },
    };
}

/**
 * @param {Element} element
 * @param {string} cls
 */
export function hasClass(element, cls) {
    return element.classList.contains(cls);
}

/**
 * @param {Document} document
 * @param {string} id
 */
export function isVisible(document, id) {
    const el = document.getElementById(id);
    if(!el)
        return false;
    for(let node = el; node; node = node.parentElement) {
        if(node.classList.contains('invisible'))
            return false;
    }
    return true;
}
