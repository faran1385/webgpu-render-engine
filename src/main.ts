import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./engine/loader/loader.ts";
import {getStats, initWebGPU} from "./helpers/global.helper.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";

import {Camera} from "./engine/camera/Camera.ts";
import {Scene} from "./engine/scene/Scene.ts";
import {OrbitControls} from "./engine/camera/controls.ts";
import {HDRLoader} from "./engine/environment/HDRLoader.ts";
import {Pane} from "tweakpane";
import {ToneMapping} from "./helpers/postProcessUtils/postProcessUtilsTypes.ts";
import {mat3, quat} from "gl-matrix";


const {device, canvas, ctx, baseLayer} = await initWebGPU()
const camera = new Camera({
    aspect: canvas.width / canvas.height,
    device,
    initialPosition: [3, 4.0, 10],
    fov: Math.PI / 3
})

const controls = new OrbitControls(camera, document.documentElement)

const stats = getStats()
const scene = new Scene(device, canvas, ctx, camera);
baseLayer.setActiveScene(scene)


const mainLayer = new RenderLayer(device, canvas, ctx)
const loader = new GLTFLoader()
const {sceneObjects, nodeMap,animations} = await loader.load("/e.glb", scene)

const hdrLoader = new HDRLoader(device);
const cubeMap = await hdrLoader.load("/e.hdr")

scene.setToneMapping = ToneMapping.ACES
await scene.backgroundManager.setBackground(cubeMap, 1)
await scene.environmentManager.setEnvironment(cubeMap, 1024, 128, 32)

scene.lightManager.addDirectional({
    intensity: 5,
    color: [1, 1, 1],
    position: [5, 5, 3]
})

const modelRenderer = new ModelRenderer({
    scene
});
console.log(mat3.fromQuat(mat3.create(),quat.identity(quat.create())))
window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})
modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setScale(3,3,3)
modelRenderer.setTranslation(0, 0, 0)
modelRenderer.setNodeMap(nodeMap)
await modelRenderer.init()
modelRenderer.animate(animations[0])
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

