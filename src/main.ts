import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./engine/loader/loader.ts";
import {initWebGPU} from "./helpers/global.helper.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";

import {Camera} from "./engine/camera/Camera.ts";
import {Scene} from "./engine/scene/Scene.ts";
import {OrbitControls} from "./engine/camera/controls.ts";
import {HDRLoader} from "./engine/environment/HDRLoader.ts";
import {ToneMapping} from "./helpers/postProcessUtils/postProcessUtilsTypes.ts";
import {ProcessManager} from "./engine/loader/processManager.ts";


const {device, canvas, ctx, baseLayer} = await initWebGPU()
const camera = new Camera({
    aspect: canvas.width / canvas.height,
    device,
    initialPosition: [3, 0, 5],
    fov: Math.PI / 3
})

const controls = new OrbitControls(camera, document.documentElement)
const loadMassage = document.getElementById("load-massage")!;
const loadPercentage = document.getElementById("load-percentage")!;
const overlay = document.querySelector(".overlay") as HTMLDivElement;

const downloadManager = new ProcessManager(2, (p) => {
    loadPercentage.innerHTML = `${p.toFixed(2)}%`
    if (p === 100) {
        loadMassage.innerHTML = `Computing Environment`
        loadPercentage.innerHTML = `0%`
    }
});

const scene = new Scene(device, canvas, ctx, camera);
baseLayer.setActiveScene(scene)

const mainLayer = new RenderLayer(device, canvas, ctx)
const loader = new GLTFLoader()

const {sceneObjects, nodeMap, animations} = await loader.load("/c.glb", scene, (percentage) => {
    downloadManager.updateIndex(0, percentage)
})

const hdrLoader = new HDRLoader(device);
const cubeMap = await hdrLoader.load("/e.hdr", (percentage) => {
    downloadManager.updateIndex(1, percentage)
})


scene.setToneMapping = ToneMapping.ACES
await scene.backgroundManager.setBackground(cubeMap, 1)
await scene.environmentManager.setEnvironment(cubeMap, 1024, 128, 32, (p) => {
    loadPercentage.innerHTML = `${p.toFixed(2)}%`
    if (p === 100) {
        overlay.style.display = "none"
    }
})

// scene.lightManager.addDirectional({
//     intensity: 2,
//     color: [1, 1, 1],
//     position: [0, 2, 3]
// })


const modelRenderer = new ModelRenderer({
    scene
});
window.addEventListener("resize", () => {
    camera.setAspect(canvas.width / canvas.height)
    camera.updateProjectionMatrix()
})
modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setNodeMap(nodeMap)

if (window.innerWidth < 768) {
    modelRenderer.setScale(.5, .5, .5)
}
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

