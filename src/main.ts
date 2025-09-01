import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./engine/loader/loader.ts";
import {initWebGPU} from "./helpers/global.helper.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";

import {Camera} from "./engine/camera/Camera.ts";
import {Scene} from "./engine/scene/Scene.ts";
import {OrbitControls} from "./engine/camera/controls.ts";
import {HDRLoader} from "./engine/environment/HDRLoader.ts";
import {ToneMapping} from "./helpers/postProcessUtils/postProcessUtilsTypes.ts";


const {device, canvas, ctx, baseLayer} = await initWebGPU()
const camera = new Camera({
    aspect: canvas.width / canvas.height,
    device,
    initialPosition: [3, 0, 5],
    fov: Math.PI / 3
})

const controls = new OrbitControls(camera, document.documentElement)

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
    position: [0, 2, 3]
})


const modelRenderer = new ModelRenderer({
    scene
});
window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})
modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setNodeMap(nodeMap)
await modelRenderer.init()
modelRenderer.animate(animations[0])


const render = () => {
    const commandEncoder = device.createCommandEncoder()

    mainLayer.render(commandEncoder);
    controls.update()
    device.queue.submit([commandEncoder.finish()])
};

const update = () => {
    baseLayer.updateGlobalBuffers()
    render()
    requestAnimationFrame(update);
}

update()

