<!--
  Vue 3 wrapper for the ParticleFX engine.
  Setup: copy assets/fx/ into your project (e.g. src/fx/), `npm i three`, then:
    <ParticleImage src="/hero.jpg" effect="ember-ascend" :progress="scrollProgress" style="height:100vh" />
  progress given -> controlled (0 formed, 1 dissolved); absent -> plays the timeline loop.
-->
<template>
  <div ref="host" class="particle-image" />
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { ParticleFX } from '../fx/index.js'; // adjust to where you copied fx/

const props = defineProps({
  src: { type: String, required: true },
  morphTo: String,
  effect: { type: String, default: 'fluid-erosion' },
  params: Object, look: Object, camera: Object, timeline: Object, depth: Object,
  quality: { type: String, default: 'high' },
  progress: { type: Number, default: null },
  interactive: { type: Boolean, default: true },
});
const emit = defineEmits(['loaded']);
const host = ref(null);
let fx = null;

async function build() {
  fx?.dispose();
  fx = new ParticleFX(host.value, { interactive: props.interactive });
  const info = await fx.load({
    image: props.src, morphTo: props.morphTo, effect: props.effect, params: props.params, look: props.look,
    camera: props.camera, timeline: props.timeline, quality: props.quality, depth: props.depth,
  });
  if (props.progress != null) fx.setProgress(props.progress, true);
  fx.start();
  emit('loaded', info);
}

onMounted(build);
onBeforeUnmount(() => { fx?.dispose(); fx = null; });
watch(() => [props.src, props.morphTo, props.quality], build);
watch(() => [props.effect, JSON.stringify(props.params)], () => fx?.points && fx.setEffect(props.effect, props.params || {}));
watch(() => JSON.stringify(props.look), () => fx?.points && fx.setLook(props.look || {}));
watch(() => JSON.stringify(props.camera), () => fx?.points && fx.setCamera(props.camera || {}));
watch(() => props.progress, (p) => { if (!fx) return; if (p == null) fx.play(); else fx.setProgress(p); });
</script>

<style scoped>
.particle-image { position: relative; width: 100%; height: 100%; overflow: hidden; }
</style>
