import {RenderLayer} from "./layers/renderLayer.ts";
import {GLTFLoader} from "./scene/loader/loader.ts";
import {BaseLayer} from "./layers/baseLayer.ts";
import {getStats, initWebGPU,} from "./helpers/global.helper.ts";
import {HashGenerator} from "./scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "./scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {ModelRenderer} from "./renderers/modelRenderer.ts";
import {SmartRender} from "./scene/GPURenderSystem/SmartRender/SmartRender.ts";
import {ComputeManager} from "./scene/computation/computeManager.ts";
import {SkinManager} from "./scene/skinManager/skinManager.ts";
import {ModelAnimator} from "./scene/modelAnimator/modelAnimator.ts";
import {vec3} from "gl-matrix";
import {ShaderGenerator} from "./scene/GPURenderSystem/ShaderGenerator/ShaderGenerator.ts";
import {
    MaterialDescriptorGenerator
} from "./scene/GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGenerator.ts";
import {RenderFlag} from "./scene/GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {LightManager} from "./scene/lightManager/lightManager.ts";


const {device, canvas, ctx} = await initWebGPU()
const stats = getStats()
const lightManager = new LightManager(device, canvas, ctx);
const baseLayer = new BaseLayer(device, canvas, ctx);
const hasher = new HashGenerator()
await hasher.init()
const gpuCache = new GPUCache(device, canvas, ctx, hasher);
const mainLayer = new RenderLayer(device, canvas, ctx, gpuCache)
const loader = new GLTFLoader(device, canvas, ctx)
const skinManager = new SkinManager(device, canvas, ctx)
const modelAnimator = new ModelAnimator()
const shaderGenerator = new ShaderGenerator()
const materialBindGroupGenerator = new MaterialDescriptorGenerator(device)

const smartRenderer = new SmartRender(device, ctx, skinManager, shaderGenerator, materialBindGroupGenerator)
const {sceneObjects, root} = await loader.load("/s.glb")
const computeManager = new ComputeManager(device, canvas, ctx);
lightManager.addDirectional({
    intensity: 1,
    color: [1,1,1],
    position: [12, 3, 3]
})


const modelRenderer = new ModelRenderer({
    device,
    canvas,
    ctx,
    hasher,
    gpuCache,
    smartRenderer,
    computeManager: computeManager,
    modelAnimator
});

modelRenderer.setRoot(root)
modelRenderer.setSceneObjects(sceneObjects)
modelRenderer.fillInitEntry(RenderFlag.PBR)
await modelRenderer.init()
modelRenderer.setScale(vec3.fromValues(5, 5, 5))

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

