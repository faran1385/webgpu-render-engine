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
const {sceneObjects, nodeMap} = await loader.load("/e.glb", scene)

const hdrLoader = new HDRLoader(device);
const cubeMap = await hdrLoader.load("/e.hdr")

scene.setToneMapping = ToneMapping.ACES
await scene.backgroundManager.setBackground(gpuCache, [1], cubeMap, 1)
await scene.environmentManager.setEnvironment(cubeMap, 1024, 128, 32)

// scene.lightManager.addDirectional({
//     intensity: 5,
//     color: [1, 1, 1],
//     position: [5, 5, 3]
// })

const modelRenderer = new ModelRenderer({
    gpuCache,
    scene
});

window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})


modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setScale(1,1,1)
modelRenderer.setTranslation(0,0,0)
modelRenderer.setNodeMap(nodeMap)
modelRenderer.fillInitEntry()
await modelRenderer.init()

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

