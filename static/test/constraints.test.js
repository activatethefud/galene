import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadApp, hasClass, isVisible} from './harness.js';

function stateOf(app, id) {
    const el = app.document.getElementById(id);
    return {
        off: hasClass(el, 'off'),
        on: hasClass(el, 'on'),
        pressed: el.getAttribute('aria-pressed'),
        icon: el.querySelector('.fas').className,
    };
}

test('camera and microphone use the configured devices', async () => {
    const app = await loadApp({
        settings: {
            video: 'cam1',
            audio: 'mic1',
            resolution: [1920, 1080],
            preprocessing: true,
        },
    });
    try {
        // the automatic preview uses the configured devices
        const initial = app.gumCalls()[0];
        assert.equal(initial.video.deviceId, 'cam1');
        assert.deepEqual(initial.video.width, {ideal: 1920});
        assert.deepEqual(initial.video.height, {ideal: 1080});
        assert.equal(initial.audio.deviceId, 'mic1');
        // with preprocessing on, no AEC flags should be forced off
        assert.equal('echoCancellation' in initial.audio, false);
        assert.equal('noiseSuppression' in initial.audio, false);
        assert.equal('autoGainControl' in initial.audio, false);

        // switching the camera off and back on keeps the configured device
        await app.window.toggleCamera();
        await app.window.toggleCamera();
        const calls = app.gumCalls();
        const video = calls[calls.length - 1].video;
        assert.equal(video.deviceId, 'cam1');
        assert.deepEqual(video.width, {ideal: 1920});
        assert.deepEqual(video.height, {ideal: 1080});
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('preprocessing off disables echo cancellation flags', async () => {
    const app = await loadApp({settings: {preprocessing: false}});
    try {
        // the automatic preview requests audio with the AEC flags disabled
        const audio = app.gumCalls()[0].audio;
        assert.equal(audio.echoCancellation, false);
        assert.equal(audio.noiseSuppression, false);
        assert.equal(audio.autoGainControl, false);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('default constraints use aspectRatio 4/3 and enable audio',
     async () => {
         const app = await loadApp({settings: {}});
         try {
             const initial = app.gumCalls()[0];
             assert.equal(initial.video.aspectRatio.ideal, 4 / 3);

             // after turning everything off and the microphone back on,
             // the audio is requested again
             await app.window.toggleCamera();
             await app.window.toggleMicrophone();
             await app.window.toggleMicrophone();
             const audio = app.gumCalls().pop().audio;
             // reflectSettings() persists the enumerated default device
             // (mic1) into the settings, so audio is always requested as a
             // constraint object, never as the boolean "true"
             assert.ok(audio && typeof audio === 'object');
             assert.equal(audio.deviceId, 'mic1');
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });

test('blackboard mode selects a wide aspect ratio', async () => {
    const app = await loadApp({settings: {blackboardMode: true}});
    try {
        const video = app.gumCalls()[0].video;
        assert.deepEqual(video.width, {min: 640, ideal: 1920});
        assert.deepEqual(video.height, {min: 400, ideal: 1080});
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('the preview video is mirrored for the user', async () => {
    const app = await loadApp({settings: {}});
    try {
        assert.equal(hasClass(app.document.getElementById('login-video'),
                              'mirror'), true);
        assert.equal(isVisible(app.document, 'login-video'), true);
        assert.deepEqual(app.errors, []);
    } finally {
        app.close();
    }
});

test('a failed getUserMedia resets the buttons and hides the preview',
     async () => {
         const app = await loadApp({});
         try {
             app.failNextGum();
             await app.window.toggleCamera();

             const s = stateOf(app, 'join-cambutton');
             assert.equal(s.on, false);
             assert.equal(s.off, true);
             assert.equal(s.pressed, 'false');
             assert.match(s.icon, /fa-video-slash/);
             assert.equal(isVisible(app.document, 'login-preview'), false);
             // the state must be consistent for both buttons afterwards
             assert.equal(stateOf(app, 'join-micbutton').pressed, 'false');
             assert.deepEqual(app.errors, []);
         } finally {
             app.close();
         }
     });
