import {MainLayer} from "./layers/mainLayer.ts";
import {GLTFLoader} from "./scene/loader/loader.ts";
import {BaseLayer} from "./layers/baseLayer.ts";
import {getStats, initWebGPU,} from "./helpers/global.helper.ts";
import {HashGenerator} from "./scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "./scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";
import {ComputeFrustumCulling} from "./scene/computeFrustumCulling.ts";
import {SmartRender} from "./scene/GPURenderSystem/SmartRender/SmartRender.ts";
import {ModelAnimator} from "./scene/modelAnimator/modelAnimator.ts";


const {device, canvas, ctx} = await initWebGPU()
const stats = getStats()
const baseLayer = new BaseLayer(device, canvas, ctx);

const mainLayer = new MainLayer(device, canvas, ctx, 10000, 10000)
const loader = new GLTFLoader()
const modelAnimator = new ModelAnimator();
const smartRender = new SmartRender(device, ctx)
const boundingCompute = new ComputeFrustumCulling();
const hasher = new HashGenerator()
await hasher.init()
const gpuCache = new GPUCache(device, canvas, ctx);
const {meshes, root, skeletonsMatList, skinIdList} = await loader.load("/test.glb")
const modelRenderer = new ModelRenderer({
    device,
    canvas,
    ctx,
    root,
    boundingComputer: boundingCompute,
    hasher,
    gpuCache
});
let baseReadyRender = smartRender.base(meshes, skeletonsMatList);
await modelRenderer.init({
    ...baseReadyRender
})
const render = () => {
    const commandEncoder = device.createCommandEncoder()
    mainLayer.render(commandEncoder);
    device.queue.submit([commandEncoder.finish()])
    modelAnimator.update(device, root.listAnimations()[1], performance.now() / 1000, root.listSkins()[0], baseReadyRender.skeletonBuffers.get(skinIdList[0]) as GPUBuffer,"loop")
};

const update = () => {
    baseLayer.update()
    stats.begin()
    render()
    stats.end()
    requestAnimationFrame(update);
}

update()
