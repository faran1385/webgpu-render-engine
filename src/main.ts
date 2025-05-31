import {MainLayer} from "./layers/mainLayer.ts";
import {GLTFLoader} from "./scene/loader/loader.ts";
import {BaseLayer} from "./layers/baseLayer.ts";
import {getStats, initWebGPU,} from "./helpers/global.helper.ts";
import {MaterialManager} from "./scene/material/materialManager.ts";
import {PipelineFlags, SelectiveResource} from "./scene/loader/loaderTypes.ts";
import {PipelineManager} from "./scene/material/pipelineManager.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";
import {ComputeFrustumCulling} from "./scene/computeFrustumCulling.ts";


const {device, canvas, ctx} = await initWebGPU()
const stats = getStats()
const baseLayer = new BaseLayer(device, canvas, ctx);
new MaterialManager(device, canvas, ctx);
new PipelineManager(device, canvas, ctx);
const mainLayer = new MainLayer(device, canvas, ctx, 200, 200)
const loader = new GLTFLoader()
const {meshes, root} = await loader.load("/m.glb")
console.log(root.listExtensionsUsed())
const computeBoundingSphere = new ComputeFrustumCulling()
const modelRenderer = new ModelRenderer(device, canvas, ctx, root, computeBoundingSphere);

await modelRenderer.init({
    meshes: meshes,
    shaderCode: PipelineFlags.SPECULAR,
    pipelineSelectiveResources: [SelectiveResource.UV, SelectiveResource.ALPHA,SelectiveResource.DOUBLE_SIDED],
})

// modelRenderer.applyTransformationsToRenderData({scale: [.009, .009, .009]})
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
