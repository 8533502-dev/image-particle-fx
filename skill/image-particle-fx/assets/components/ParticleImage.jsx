// React wrapper for the ParticleFX engine.
// Setup: copy assets/fx/ into your project (e.g. src/fx/), `npm i three`, then:
//   <ParticleImage src="/hero.jpg" effect="silk" progress={scrollProgress} style={{ height: '100vh' }} />
// - `progress` given  -> controlled: 0 = image formed, 1 = dissolved (e.g. bind to scroll / hover).
// - `progress` absent -> plays `timeline` (or the default hold → dissolve → reform loop).
import { useEffect, useRef } from 'react';
import { ParticleFX } from '../fx/index.js'; // adjust to where you copied fx/

export default function ParticleImage({
    src, morphTo, effect = 'fluid-erosion', params, look, camera, timeline, quality = 'high',
    depth, progress, interactive = true, onLoaded, className, style,
}) {
    const host = useRef(null);
    const fx = useRef(null);

    // (re)build when the image or quality changes
    useEffect(() => {
        const engine = new ParticleFX(host.current, { interactive });
        fx.current = engine;
        let alive = true;
        engine.load({ image: src, morphTo, effect, params, look, camera, timeline, quality, depth })
            .then(info => { if (!alive) return; if (progress != null) engine.setProgress(progress, true); engine.start(); onLoaded?.(info); })
            .catch(err => console.error('[ParticleImage]', err));
        return () => { alive = false; engine.dispose(); fx.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, morphTo, quality, interactive]);

    // cheap live updates
    useEffect(() => { if (fx.current?.points) fx.current.setEffect(effect, params || {}); }, [effect, JSON.stringify(params)]);
    useEffect(() => { if (fx.current?.points) fx.current.setLook(look || {}); }, [JSON.stringify(look)]);
    useEffect(() => { if (fx.current?.points) fx.current.setCamera(camera || {}); }, [JSON.stringify(camera)]);
    useEffect(() => { if (fx.current?.points && timeline) fx.current.setTimeline(timeline); }, [JSON.stringify(timeline)]);
    useEffect(() => {
        const e = fx.current; if (!e) return;
        if (progress == null) e.play(); else e.setProgress(progress);
    }, [progress]);

    return <div ref={host} className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }} />;
}
