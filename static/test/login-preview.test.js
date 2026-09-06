import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, hasClass, isVisible, waitFor} from './harness.js';

function joinState(app, id) {
    const el = app.document.getElementById(id);
    const icon = el.querySelector('.fas');
    return {
        off: hasClass(el, 'off'),
        on: hasClass(el, 'on'),
        pressed: el.getAttribute('aria-pressed'),
        icon: icon ? icon.className : '',
    };
}

test('media start on and a live preview is acquired automatically',
     async () => {
         const app = await loadApp({});
         try {
             assert.equal(isVisible(app.document, 'login-container'), true);
             for(const id of ['join-cambutton', 'join-micbutton']) {
                 const s = joinState(app, id);
                 assert.equal(s.on, true, `${id} should start on`);
                 assert.equal(s.off, false, `${id} should not be off`);
                 assert.equal(s.pressed, 'true', `${id} aria-pressed`);
             }
             assert.match(joinState(app, 'join-cambutton').icon, /fa-video/);
             assert.doesNotMatch(joinState(app, 'join-cambutton').icon,
                                 /fa-video-slash/);
             assert.match(joinState(app, 'join-micbutton').icon,
                          /fa-microphone$/);

             assert.equal(isVisible(app.document, 'login-preview'), true);
             assert.equal(isVisible(app.document, 'login-video'), true);
             assert.equal(isVisible(app.document, 'login-audio-only'), false);

             const calls = app.gumCalls();
             assert.equal(calls.length, 1);
             assert.ok(calls[0].audio && typeof calls[0].audio === 'object');
             assert.ok(calls[0].video && typeof calls[0].video === 'object');

             // the on-air indicator and logout button only appear in a room
             assert.equal(isVisible(app.document, 'air-indicator'), false);
             assert.equal(isVisible(app.document, 'logoutbutton'), false);
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });

test('clicking the camera button turns the camera off but keeps the mic on',
     async () => {
         const app = await loadApp({});
         try {
             app.document.getElementById('join-cambutton').click();

             // the click only kicks off the (async) preview update
             await waitFor(
                 () => isVisible(app.document, 'login-audio-only'),
                 'audio-only panel did not appear after turning the ' +
                     'camera off');

             const s = joinState(app, 'join-cambutton');
             assert.equal(s.on, false);
             assert.equal(s.off, true);
             assert.equal(s.pressed, 'false');
             assert.match(s.icon, /fa-video-slash/);
             assert.equal(joinState(app, 'join-micbutton').pressed, 'true');

             assert.equal(isVisible(app.document, 'login-video'), false);
             assert.equal(isVisible(app.document, 'login-audio-only'), true);

             const calls = app.gumCalls();
             assert.equal(calls.length, 2);
             assert.ok(calls[1].audio && typeof calls[1].audio === 'object');
             assert.equal(calls[1].video, false);
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });

test('microphone alone shows the audio panel, not the video', async () => {
    const app = await loadApp({});
    try {
        // switch the camera off; the microphone stays on
        await app.window.toggleCamera();
        await waitFor(
            () => isVisible(app.document, 'login-audio-only'),
            'audio-only panel did not appear');

        const s = joinState(app, 'join-micbutton');
        assert.equal(s.on, true);
        assert.equal(s.pressed, 'true');
        assert.match(s.icon, /fa-microphone$/);

        assert.equal(isVisible(app.document, 'login-preview'), true);
        assert.equal(isVisible(app.document, 'login-video'), false);
        assert.equal(isVisible(app.document, 'login-audio-only'), true);

        const calls = app.gumCalls();
        assert.equal(calls.length, 2);
        assert.ok(calls[1].audio && typeof calls[1].audio === 'object');
        assert.equal(calls[1].video, false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('turning the microphone off leaves the camera preview running',
     async () => {
         const app = await loadApp({});
         try {
             await app.window.toggleMicrophone();

             assert.equal(joinState(app, 'join-micbutton').pressed, 'false');
             assert.match(joinState(app, 'join-micbutton').icon,
                          /fa-microphone-slash/);
             assert.equal(joinState(app, 'join-cambutton').pressed, 'true');

             assert.equal(isVisible(app.document, 'login-video'), true);
             assert.equal(isVisible(app.document, 'login-audio-only'), false);

             const calls = app.gumCalls();
             assert.equal(calls.length, 2);
             assert.equal(calls[1].audio, false);
             assert.ok(calls[1].video && typeof calls[1].video === 'object');
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });

test('re-enabling both devices shows the combined preview again',
     async () => {
         const app = await loadApp({});
         try {
             await app.window.toggleCamera();
             await waitFor(
                 () => isVisible(app.document, 'login-audio-only'),
                 'audio-only panel did not appear');
             await app.window.toggleMicrophone();

             await app.window.toggleCamera();
             await waitFor(
                 () => isVisible(app.document, 'login-video'),
                 'video preview did not reappear');
             await app.window.toggleMicrophone();

             assert.equal(joinState(app, 'join-cambutton').pressed, 'true');
             assert.equal(joinState(app, 'join-micbutton').pressed, 'true');
             assert.equal(isVisible(app.document, 'login-video'), true);
             assert.equal(isVisible(app.document, 'login-audio-only'), false);
             assert.equal(hasClass(app.document.getElementById('login-video'),
                                   'mirror'), true);

             const calls = app.gumCalls();
             // initial preview + a call for each toggle that keeps a device
             // running (the both-off toggle does not open a device)
             assert.equal(calls.length, 4);
             assert.ok(calls[3].audio);
             assert.ok(calls[3].video);
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });

test('turning everything off stops the preview and releases the device',
     async () => {
         const app = await loadApp({});
         try {
             await app.window.toggleCamera();
             await app.window.toggleMicrophone();

             assert.equal(isVisible(app.document, 'login-preview'), false);
             assert.equal(isVisible(app.document, 'login-audio-only'), false);
             assert.equal(joinState(app, 'join-cambutton').on, false);
             assert.equal(joinState(app, 'join-micbutton').on, false);

             // both toggles off, so the second one does not open a device
             const calls = app.gumCalls();
             assert.equal(calls.length, 2);

             const streams = app.streams();
             assert.ok(streams.length >= 2);
             for(const stream of streams) {
                 const tracks = stream.getTracks();
                 for(const track of tracks)
                     assert.equal(track.readyState, 'ended',
                                  'device tracks must be released');
             }
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });

test('stopping the preview twice is harmless', async () => {
    const app = await loadApp({});
    try {
        await app.window.stopLoginPreview();
        await app.window.stopLoginPreview();
        assert.equal(isVisible(app.document, 'login-preview'), false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});
