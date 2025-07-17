import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./engine/loader/loader.ts";
import {BaseLayer} from "./layers/baseLayer.ts";
import {getStats, initWebGPU,} from "./helpers/global.helper.ts";
import {HashGenerator} from "./engine/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "./engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";

import {vec3} from "gl-matrix";
import {RenderFlag} from "./engine/GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Camera} from "./engine/camera/Camera.ts";
import {Scene} from "./engine/scene/Scene.ts";
import {OrbitControls} from "./engine/camera/controls.ts";
import {ToneMapping} from "./engine/postProcessUtils/postProcessUtilsTypes.ts";
import {HDRLoader} from "./engine/environment/HDRLoader.ts";


const {device, canvas, ctx} = await initWebGPU()
const camera = new Camera({
    aspect: canvas.width / canvas.height,
    device,
    initialPosition: [0, 0, 30]
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
const loader = new GLTFLoader(device, canvas, ctx)


const {sceneObjects, nodeMap} = await loader.load("/s.glb", scene)
const hdrLoader = new HDRLoader(device);
const cubeMap = await hdrLoader.load("/e.hdr", ToneMapping.REINHARD_MAX, 2)
await scene.backgroundManager.setBackground(gpuCache, [1], cubeMap)
await scene.environmentManager.setEnvironment(cubeMap)
scene.lightManager.addDirectional({
    intensity: 2,
    color: [1, 1, 1],
    position: [10, 5, 0]
})

console.log(device)
const modelRenderer = new ModelRenderer({
    gpuCache,
    device,
    format: baseLayer.format,
    scene
});

window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})
modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setNodeMap(nodeMap)
modelRenderer.enableFrustumCulling()
modelRenderer.fillInitEntry(RenderFlag.PBR)
await modelRenderer.init()
modelRenderer.setScale(vec3.fromValues(5, 5, 5))

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

