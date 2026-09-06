import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, waitFor, isVisible} from './harness.js';

// The Mic/Camera toggle state is remembered under this localStorage key and
// restored on the next page load or after a disconnect, so that automatic
// logins start with the devices in the state the user left them in.
const MEDIA_KEY = 'galene.media';

function storedMedia(window) {
    const raw = window.localStorage.getItem(MEDIA_KEY);
    if(!raw)
        return null;
    return JSON.parse(raw);
}

function mediaEntry(camera, mic) {
    return JSON.stringify({camera: camera, mic: mic});
}

async function joinButtonState(app, id) {
    const elt = app.document.getElementById(id);
    const icon = elt.querySelector('.fas');
    return {
        off: elt.classList.contains('off'),
        on: elt.classList.contains('on'),
        pressed: elt.getAttribute('aria-pressed'),
        icon: icon.className,
    };
}

test('toggling the microphone or camera on the login screen is remembered', async () => {
    const app = await loadApp({});
    try {
        // Defaults: both devices on.
        await waitFor(() => app.gumCalls().length >= 1,
                      'no initial preview: ' + JSON.stringify(app.errors));
        await app.window.toggleCamera();
        let media = storedMedia(app.window);
        assert.equal(media.camera, false);
        assert.equal(media.mic, true);

        await app.window.toggleMicrophone();
        media = storedMedia(app.window);
        assert.equal(media.camera, false);
        assert.equal(media.mic, false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a stored media preference is restored on page load', async () => {
    const app = await loadApp({
        localStorage: {
            [MEDIA_KEY]: mediaEntry(false, true),
        },
    });
    try {
        // Camera off, microphone on: the preview shows the audio panel only
        // and the initial getUserMedia request has no video track.
        let cam = await joinButtonState(app, 'join-cambutton');
        assert.equal(cam.on, false);
        assert.equal(cam.off, true);
        assert.equal(cam.pressed, 'false');
        assert.match(cam.icon, /fa-video-slash/);
        let mic = await joinButtonState(app, 'join-micbutton');
        assert.equal(mic.on, true);
        assert.match(mic.icon, /fa-microphone$/);
        assert.equal(isVisible(app.document, 'login-preview'), true);
        assert.equal(isVisible(app.document, 'login-video'), false);
        assert.equal(isVisible(app.document, 'login-audio-only'), true);
        let calls = app.gumCalls();
        assert.ok(calls.length >= 1);
        assert.equal(calls[0].video, false);
        assert.ok(calls[0].audio && typeof calls[0].audio === 'object');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a stored preference with both devices off starts with no preview', async () => {
    const app = await loadApp({
        localStorage: {
            [MEDIA_KEY]: mediaEntry(false, false),
        },
        waitLogin: false,
    });
    try {
        await waitFor(() => isVisible(app.document, 'login-container'),
                      'login screen was not shown: ' +
                          JSON.stringify(app.errors));
        let cam = await joinButtonState(app, 'join-cambutton');
        assert.equal(cam.off, true);
        assert.equal(cam.pressed, 'false');
        let mic = await joinButtonState(app, 'join-micbutton');
        assert.equal(mic.off, true);
        assert.equal(mic.pressed, 'false');
        assert.equal(isVisible(app.document, 'login-preview'), false);
        assert.equal(app.gumCalls().length, 0);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('after a disconnect the stored media preference is restored', async () => {
    const app = await loadApp({});
    try {
        // Turn the camera off (persists {camera:false, mic:true}).
        await app.window.toggleCamera();
        const before = app.gumCalls().length;

        // Establish a ServerConnection object (without a working socket)
        // so that the onclose path can run: a socket close returns to the
        // login screen and the preview must come back with the camera
        // still off and the mic still on.
        await app.window.serverConnect();
        app.window.gotClose(1000, 'test');
        await waitFor(() => app.gumCalls().length > before,
                      'preview did not restart after disconnect: ' +
                          JSON.stringify(app.errors));
        let cam = await joinButtonState(app, 'join-cambutton');
        assert.equal(cam.off, true);
        assert.equal(cam.pressed, 'false');
        let mic = await joinButtonState(app, 'join-micbutton');
        assert.equal(mic.on, true);
        assert.equal(mic.pressed, 'true');
        let calls = app.gumCalls();
        assert.equal(calls[calls.length - 1].video, false);
        assert.ok(calls[calls.length - 1].audio &&
                  typeof calls[calls.length - 1].audio === 'object');
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
