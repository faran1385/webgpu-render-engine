import {MainLayer} from "./layers/mainLayer.ts";
import {GLTFLoader} from "./scene/loader/loader.ts";
import {BaseLayer} from "./layers/baseLayer.ts";
import {getStats, initWebGPU,} from "./helpers/global.helper.ts";
import {HashGenerator} from "./scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "./scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";
import {SmartRender} from "./scene/GPURenderSystem/SmartRender/SmartRender.ts";
import {ComputeManager} from "./scene/computation/computeManager.ts";


const {device, canvas, ctx} = await initWebGPU()
const stats = getStats()
const baseLayer = new BaseLayer(device, canvas, ctx);

const mainLayer = new MainLayer(device, canvas, ctx)
const loader = new GLTFLoader()
const smartRenderer = new SmartRender(device, ctx)
const hasher = new HashGenerator()
await hasher.init()
const gpuCache = new GPUCache(device, canvas, ctx);
const {sceneObjects, root} = await loader.load("/merged.glb")
const computeManager = new ComputeManager(device, canvas, ctx);
const modelRenderer = new ModelRenderer({
    device,
    canvas,
    ctx,
    hasher,
    gpuCache,
    smartRenderer,
    computeManager: computeManager
});

modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.setRoot(root)
modelRenderer.fillInitEntry("base")
await modelRenderer.init()
modelRenderer.setLodThreshold(7)

const render = () => {
    const commandEncoder = device.createCommandEncoder()
    mainLayer.render(commandEncoder);
    device.queue.submit([commandEncoder.finish()])
};

const update = () => {
    baseLayer.update()
    stats.begin()
    render()
    stats.end()
    requestAnimationFrame(update);
}

update()
