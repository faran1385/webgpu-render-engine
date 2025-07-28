import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./engine/loader/loader.ts";
import {BaseLayer} from "./layers/baseLayer.ts";
import {getStats, initWebGPU,} from "./helpers/global.helper.ts";
import {HashGenerator} from "./engine/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "./engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";

import {Camera} from "./engine/camera/Camera.ts";
import {Scene} from "./engine/scene/Scene.ts";
import {OrbitControls} from "./engine/camera/controls.ts";
import {HDRLoader} from "./engine/environment/HDRLoader.ts";
import {Pane} from "tweakpane";
import {ToneMapping} from "./helpers/postProcessUtils/postProcessUtilsTypes.ts";


const {device, canvas, ctx} = await initWebGPU()
const camera = new Camera({
    aspect: canvas.width / canvas.height,
    device,
    initialPosition: [3, 4.0, 10],
    fov: Math.PI / 3
})

const controls = new OrbitControls(camera, document.documentElement)

const stats = getStats()
const baseLayer = new BaseLayer(device, canvas, ctx);
const scene = new Scene(device, canvas, ctx, camera);
baseLayer.setActiveScene(scene)

const hasher = new HashGenerator()
await hasher.init()
const gpuCache = new GPUCache(device, canvas, ctx, hasher);

const mainLayer = new RenderLayer(device, canvas, ctx, gpuCache)
const loader = new GLTFLoader()
const {sceneObjects, nodeMap} = await loader.load("/a.glb", scene)

const hdrLoader = new HDRLoader(device);
const cubeMap = await hdrLoader.load("/e.hdr")

scene.setToneMapping = ToneMapping.ACES
await scene.backgroundManager.setBackground(gpuCache, [1], cubeMap, 1)
await scene.environmentManager.setEnvironment(cubeMap, 1024, 64, 32)

scene.lightManager.addAmbient({
    intensity: 0.3,
    color: [1, 1, 1],
})

const modelRenderer = new ModelRenderer({
    gpuCache,
    scene
});

window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})


modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.enableFrustumCulling()
modelRenderer.setNodeMap(nodeMap)
modelRenderer.fillInitEntry()
await modelRenderer.init()
// const primitive = sceneObjects.entries().next().value.entries().next().value![1].primitives.entries().next().value![1]

const pane = new Pane();
const paneElement = pane.element;
paneElement.style.zIndex = "103";
paneElement.style.position = "absolute";
paneElement.style.right = "10px";
paneElement.style.top = "10px";
paneElement.style.width = "300px";
document.body.appendChild(paneElement)
pane.element.addEventListener("mouseover", () => {
    controls.disable()
})

pane.element.addEventListener("mouseleave", () => {
    controls.enable()
})
const params = {
    exposure: 1,
    roughness: 0.5,
    metallic: 0.5,
    albedo: {r: 1, g: 1, b: 1}
}
pane.addBinding(params, "exposure", {
    min: 0, max: 10,
}).on("change", (T) => {
    scene.environmentManager.setExposure(T.value)
})
// pane.addBinding(params, "roughness", {
//     min: 0, max: 1,
// }).on("change", (T) => {
//     primitive.material.setRoughnessFactor(T.value)
// })
//
// pane.addBinding(params, "metallic", {
//     min: 0, max: 1,
// }).on("change", (T) => {
//     primitive.material.setMetallicFactor(T.value)
// })
//
// pane.addBinding(params, "albedo").on("change", (T) => {
//     primitive.material.setBaseColorFactor([T.value.r / 255, T.value.g / 255, T.value.b / 255, 1]);
// })


const render = () => {
    const commandEncoder = device.createCommandEncoder()
    mainLayer.render(commandEncoder);
    controls.update()
    device.queue.submit([commandEncoder.finish()])
};

const update = () => {
    baseLayer.updateGlobalBuffers()
    stats.begin()
    render()
    stats.end()
    requestAnimationFrame(update);
}

update()

