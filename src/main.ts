import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./engine/loader/loader.ts";
import {getStats, hexToVec3, initWebGPU} from "./helpers/global.helper.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";

import {Camera} from "./engine/camera/Camera.ts";
import {Scene} from "./engine/scene/Scene.ts";
import {OrbitControls} from "./engine/camera/controls.ts";
import {HDRLoader} from "./engine/environment/HDRLoader.ts";
import {Pane} from "tweakpane";
import {ToneMapping} from "./helpers/postProcessUtils/postProcessUtilsTypes.ts";


const {device, canvas, ctx, baseLayer} = await initWebGPU()
const camera = new Camera({
    aspect: canvas.width / canvas.height,
    device,
    initialPosition: [3, 0, 5],
    fov: Math.PI / 3
})

const controls = new OrbitControls(camera, document.documentElement)

const stats = getStats()
const scene = new Scene(device, canvas, ctx, camera);
baseLayer.setActiveScene(scene)


const mainLayer = new RenderLayer(device, canvas, ctx)
const loader = new GLTFLoader()
const {sceneObjects, nodeMap, animations} = await loader.load("/c.glb", scene)

const hdrLoader = new HDRLoader(device);
const cubeMap = await hdrLoader.load("/e.hdr")
scene.setToneMapping = ToneMapping.ACES
await scene.backgroundManager.setBackground(cubeMap, 1)
await scene.environmentManager.setEnvironment(cubeMap, 1024, 128, 32)

scene.lightManager.addDirectional({
    intensity: 2,
    color: [1, 1, 1],
    position: [0, 3, 0]
})


const modelRenderer = new ModelRenderer({
    scene
});
window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})
modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setTranslation(0, 0, 0)
modelRenderer.setNodeMap(nodeMap)
await modelRenderer.init()
modelRenderer.animate(animations[0])

const factors = {
    metallic: 0,
    roughness: 0,
    ior: 1.5,
    clearcoatIOR: 1.5,
    sheenRoughness: 0,
    sheenColor:"#111"
}
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

pane.addBinding(factors, "sheenRoughness", {
    min: 0,
    max: 1
}).on("change", (ev) => modelRenderer.materials.forEach(mat => mat.setSheenRoughness(ev.value!)))

pane.addBinding(factors, "sheenColor", {
    color:{}
}).on("change", (ev) => modelRenderer.materials.forEach(mat => {
    mat.setSheenColor(hexToVec3(ev.value))
}))

pane.addBinding(factors, "metallic", {
    min: 0,
    max: 1
}).on("change", (ev) => modelRenderer.materials.forEach(mat => mat.setMetallic(ev.value!)))
pane.addBinding(factors, "roughness", {
    min: 0,
    max: 1
}).on("change", (ev) => modelRenderer.materials.forEach(mat => mat.setRoughness(ev.value!)))
pane.addBinding(factors, "ior", {
    min: 1,
    max: 8
}).on("change", (ev) => modelRenderer.materials.forEach(mat => mat.setIOR(ev.value!)))
pane.addBinding(factors, "clearcoatIOR", {
    min: 1,
    max: 8
}).on("change", (ev) => modelRenderer.materials.forEach(mat => mat.setClearcoatIOR(ev.value!)))


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

