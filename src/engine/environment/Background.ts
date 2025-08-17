import {BaseLayer} from "../../layers/baseLayer.ts";
import {quat, vec3} from "gl-matrix";
import {
    hashAndCreateRenderSetup,
} from "../../helpers/global.helper.ts";
import {Geometry} from "../geometry/Geometry.ts";
import {SceneObject} from "../sceneObject/sceneObject.ts";
import {Primitive} from "../primitive/Primitive.ts";
import {cubeIndices, cubePositions} from "./cubeData.ts";
import {Scene} from "../scene/Scene.ts";
import {
    EXPOSURE,
    GAMMA_CORRECTION,
    TONE_MAPPING, TONE_MAPPING_CALL
} from "../../helpers/postProcessUtils/postProcessUtilsShaderCodes.ts";
import {StandardMaterial} from "../Material/StandardMaterial.ts";

export class Background extends BaseLayer {
    private lastSceneObject: SceneObject | null = null;
    private scene!: Scene;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, scene: Scene) {
        super(device, canvas, ctx);
        this.scene = scene;
    }


    initRenderClass(exposure: number) {

        const material = new StandardMaterial()
        const geometry = new Geometry({
            dataList: new Map([["POSITION", {
                array: cubePositions,
                itemSize: 3
            }]]),
            indices: cubeIndices,
            indexType: "uint16",
            indexCount: cubeIndices.length,
        })

        geometry.descriptors.layout = [{
            binding: 0,
            buffer: {
                type: "uniform"
            },
            visibility: GPUShaderStage.VERTEX
        }]


        material.bindGroupLayout = BaseLayer.bindGroupLayouts.background.layout
        material.setHashes("bindGroupLayout", BaseLayer.bindGroupLayouts.background.hash)

        const primitive = new Primitive()
        const toneMapping = this.scene.getToneMapping(primitive);

        geometry.shaderCode = `
        struct vsOutput{
            @builtin(position) clipPos:vec4f,
            @location(0) dir:vec3f,
            @location(1) uv:vec2f,
        }
        struct vsInput{
            @location(0) pos:vec3f,
        }
        
        @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
        @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
        @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;


        fn getViewWithoutTranslation(view: mat4x4<f32>) -> mat4x4<f32> {
            return mat4x4<f32>(
                vec4<f32>(view[0].xyz, 0.0),
                vec4<f32>(view[1].xyz, 0.0),
                vec4<f32>(view[2].xyz, 0.0),
                vec4<f32>(0,0,0, 1.0)
            );
        }
        
        @vertex fn vs(in: vsInput) -> vsOutput {
            var output: vsOutput;
        
            let viewMatrixWithoutTranslation=getViewWithoutTranslation(viewMatrix);
        
            let worldPos = modelMatrix * vec4f(in.pos,1.0);
        
            output.clipPos = projectionMatrix * viewMatrixWithoutTranslation * worldPos;
        
            output.dir = worldPos.xyz;
            output.uv=in.pos.xy;
            return output;
        }
        `
        material.shaderCode = `
        

        struct vsOutput{
            @builtin(position) clipPos:vec4f,
            @location(0) dir:vec3f,
            @location(1) uv:vec2f,
        }

        ${GAMMA_CORRECTION}
        ${EXPOSURE}
        ${TONE_MAPPING}
        override TONE_MAPPING_NUMBER = 0;
        override EXPOSURE = 1.;

        @group(1) @binding(1) var skyboxTexture: texture_cube<f32>;
        @group(1) @binding(0) var skyboxSampler: sampler;
        
        @fragment
        fn fs(in:vsOutput) -> @location(0) vec4f {
        
           
            var color = textureSample(skyboxTexture, skyboxSampler, normalize(in.dir)).rgb;
            ${TONE_MAPPING_CALL}
            color = applyExposure(color,EXPOSURE);
            color = applyGamma(color,2.2);
            return vec4(color, 1.0);
        }
        `
        material.addPrimitive(primitive)
        primitive.setGeometry(geometry)
        primitive.setMaterial(material)
        primitive.setSide("front")
        material.name = "Background mat"
        primitive.setPipelineDescriptor("front", {
            primitive: {
                cullMode: "front",
            },
            depthStencil: {
                depthCompare: "less-equal",
                depthWriteEnabled: false,
                format: "depth24plus"
            },
            targets: [{format: Background.format}],
            fragmentConstants: {
                TONE_MAPPING_NUMBER: toneMapping,
                EXPOSURE: exposure
            }
        })
        primitive.setVertexBufferDescriptors([{
            name: 'POSITION',
            attributes: [{
                offset: 0,
                shaderLocation: 0,
                format: "float32x3"
            }],
            arrayStride: 3 * 4,
        }])

        const sceneObject = new SceneObject({
            name: "Environment cube",
            scale: vec3.fromValues(1, 1, 1),
            translation: vec3.fromValues(0, 0, 0),
            rotation: quat.fromValues(0, 0, 0, 1),
            scene: this.scene
        })

        sceneObject.setScale(sceneObject.transformMatrix, vec3.fromValues(100, 100, 100))
        sceneObject.createModelBuffer(Background.device)
        primitive.sceneObject = sceneObject
        geometry.descriptors.bindGroup = [{
            name: "model",
            resource: {
                buffer: sceneObject.modelBuffer!
            },
            binding: 0
        }]
        sceneObject.appendPrimitive(primitive)

        material.descriptor.bindGroupEntries.push({
            bindingPoint: 0,
            sampler: BaseLayer.samplers.default
        })
        return {
            sceneObject,
            primitive
        }
    }

    private deletePrevious() {
        if (this.lastSceneObject) {
            (this.lastSceneObject.scene.background?.material as any)?.descriptor?.entries[0]?.textureDescriptor.texture.destroy()
            this.lastSceneObject.scene.computeManager.indirectDraw.deleteIndirect(this.lastSceneObject)
            this.lastSceneObject.scene.computeManager.indirectDraw.deleteIndex(this.lastSceneObject)
        }
        if (this.scene.background) {
            BaseLayer.gpuCache.disposePrimitive(this.scene.background, this.scene.background.sides[0])
        }
    }


    async setBackground(cubeMap: GPUTexture, exposure: number | undefined = undefined) {
        const {primitive, sceneObject} = this.initRenderClass(exposure ?? 1)


        primitive.material.descriptor.bindGroupEntries.push({
            additional: {
                resourcesKey: `Cube_Texture`,
            },
            textureDescriptor: {
                texture: cubeMap,
                viewDescriptor: {
                    dimension: "cube",
                }
            },
            bindingPoint: 1
        })
        primitive.material.descriptor.layoutEntries.push({
            texture: {
                sampleType: "float",
                viewDimension: "cube"
            },
            visibility: GPUShaderStage.FRAGMENT,
            binding: 1
        })

        await hashAndCreateRenderSetup(this.scene.computeManager, [primitive.material], [primitive], true)

        this.deletePrevious()

        this.scene.setBackground = primitive
        this.lastSceneObject = sceneObject;
    }
}