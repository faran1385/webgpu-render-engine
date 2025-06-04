import {BindGroupEntryCreationType, RenderState} from "../GPUCache/GPUCacheTypes.ts";
import {hashCreationBindGroupEntry} from "../Hasher/HashGenerator.ts";
import {convertAlphaMode, createGPUBuffer, getTextureFromData} from "../../../helpers/global.helper.ts";
import {Material, Texture, vec2} from "@gltf-transform/core";
import {MeshData} from "../../loader/loaderTypes.ts";
import {EmissiveStrength} from "@gltf-transform/extensions";

type outputType = {
    meshes: MeshData[],
    materialBindGroupLayout: { layoutsEntries: GPUBindGroupLayoutEntry[][], primitiveIndex: number[] },
    geometryBindGroupLayout: { entries: GPUBindGroupLayoutEntry[][], primitiveIndex: number[] },
    pipelineDescriptors: RenderState[],
    geometryBindGroup: {
        entries: (GPUBindGroupEntry & {
            name: "model" | "normal";
        })[], mesh: MeshData
    }[],
    materialBindGroup: {
        hashEntries: hashCreationBindGroupEntry,
        entries: BindGroupEntryCreationType[],
        material: Material
    }[],
    shaderCodes: { codes: string[], primitiveIndex: number[] },
}

type callFrom = "Emissive" | "BaseColor"

export class SmartRender {
    static defaultSampler: GPUSampler;
    static device: GPUDevice;
    static ctx: GPUCanvasContext;
    static initialized: boolean = false;
    static defaultMaterialBindGroupLayout: GPUBindGroupLayoutEntry[][] = []
    static defaultGeometryBindGroupLayout: GPUBindGroupLayoutEntry[][] = []

    constructor(device: GPUDevice, ctx: GPUCanvasContext) {
        if (this.constructor === SmartRender && !SmartRender.initialized) {
            SmartRender.initialized = true;
            SmartRender.device = device;
            SmartRender.ctx = ctx;
            SmartRender.defaultSampler = device.createSampler({
                label: "default sampler",
                addressModeW: "repeat",
                addressModeV: "repeat",
                addressModeU: "repeat",
                minFilter: "linear",
                magFilter: "linear"
            });

            SmartRender.defaultGeometryBindGroupLayout.push([{
                binding: 0,
                buffer: {
                    type: "uniform",
                },
                visibility: GPUShaderStage.VERTEX
            }])
            SmartRender.defaultMaterialBindGroupLayout.push([
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform"
                    }
                }, {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: "float"
                    }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: "filtering"
                    }
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform"
                    }
                }
            ], [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform"
                    }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: "uniform"
                    }
                }
            ])
        }
    }

    private getGeometryBindGroups(meshes: MeshData[]) {
        return meshes.map((mesh) => {
            return {
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: createGPUBuffer(SmartRender.device, mesh.localMatrix, GPUBufferUsage.UNIFORM, `model matrix buffer ${mesh.nodeName}`)
                        },
                        name: "model"
                    },
                ] as (GPUBindGroupEntry & { name: "model" | "normal" })[],
                mesh
            }
        })
    }

    private getMaterialBindGroups(
        meshes: MeshData[],
        callFrom: "Emissive" | "BaseColor",
        getExtraFactor: ((material: Material) => number[]) | undefined = undefined
    ) {
        const usedTextureUvIndices: number[] = []
        return {
            groups: meshes.map(mesh => mesh.geometry.map((prim, i) => {
                const entries: BindGroupEntryCreationType[] = []
                const hashEntries: hashCreationBindGroupEntry = []
                const factors: number[] = [
                    ...prim.material[`get${callFrom}Factor`]()
                ]

                console.log(mesh.nodeName, prim.material.getEmissiveFactor())
                if (getExtraFactor) {
                    factors.push(...getExtraFactor(prim.material))
                }
                entries.push({
                    bindingPoint: 0,
                    typedArray: {
                        conversion: createGPUBuffer,
                        usage: GPUBufferUsage.UNIFORM,
                        label: `${mesh.nodeName} factors at prim : ${i}`,
                        data: new Float32Array(factors),
                        conversionType: "buffer"
                    },
                })

                if (prim.material[`get${callFrom}Texture`]()) {
                    usedTextureUvIndices.push(prim.material[`get${callFrom}TextureInfo`]()?.getTexCoord() as number)
                    const image = (prim.material[`get${callFrom}Texture`]() as Texture).getImage() as Uint8Array
                    entries.push({
                        bindingPoint: 1,
                        typedArray: {
                            conversion: getTextureFromData,
                            conversionType: "texture",
                            size: (prim.material[`get${callFrom}Texture`]() as Texture).getSize() as vec2,
                            data: image
                        },
                    })

                    entries.push({
                        bindingPoint: 2,
                        sampler: SmartRender.defaultSampler
                    })
                    hashEntries.push(image)
                    hashEntries.push({
                        label: "default sampler",
                        addressModeW: "repeat",
                        addressModeV: "repeat",
                        addressModeU: "repeat",
                        minFilter: "linear",
                        magFilter: "linear"
                    })
                }
                const alpha = new Float32Array([convertAlphaMode(prim.material.getAlphaMode()), prim.material.getAlphaCutoff()]);
                entries.push({
                    bindingPoint: prim.material[`get${callFrom}Texture`]() ? 3 : 1,
                    typedArray: {
                        conversion: createGPUBuffer,
                        conversionType: "buffer",
                        data: alpha,
                        label: `${mesh.nodeName} alphaMode at prim : ${i}`,
                        usage: GPUBufferUsage.UNIFORM
                    },
                })

                hashEntries.push(alpha)

                return {
                    entries,
                    material: prim.material,
                    hashEntries
                }
            })).flat(),
            usedTextureUvIndices: usedTextureUvIndices
        }
    }

    private getPipelineDescriptors(meshes: MeshData[], usedTextureUvIndices: number[]) {
        return meshes.map((mesh) => mesh.geometry.map((prim, i): RenderState => {
            const buffers: (GPUVertexBufferLayout & { name: string; })[] = [{
                arrayStride: 3 * 4,
                attributes: [{
                    offset: 0,
                    shaderLocation: 0,
                    format: "float32x3"
                }],
                name: 'POSITION'
            }]

            if (prim.dataList[`TEXCOORD_${usedTextureUvIndices[i]}`]) {
                buffers.push({
                    arrayStride: 2 * 4,
                    attributes: [{
                        offset: 0,
                        shaderLocation: 1,
                        format: "float32x2"
                    }],
                    name: `TEXCOORD_${usedTextureUvIndices[i]}`
                })
            }

            return {
                primitive: {
                    cullMode: prim.material.getDoubleSided() ? "none" : "back",
                    frontFace: "ccw",
                },
                depthStencil: {
                    depthCompare: "less",
                    depthWriteEnabled: prim.material.getAlphaMode() !== "BLEND",
                    format: "depth24plus"
                },
                targets: [{
                    writeMask: GPUColorWrite.ALL,
                    blend: prim.material.getAlphaMode() === "BLEND" ? {
                        color: {
                            srcFactor: "src-alpha",
                            dstFactor: "one-minus-src-alpha",
                            operation: "add",
                        },
                        alpha: {
                            srcFactor: "one",
                            dstFactor: "zero",
                            operation: "add",
                        },
                    } : undefined,
                    format: SmartRender.ctx.getConfiguration()?.format as GPUTextureFormat
                }],
                buffers
            }
        })).flat()
    }


    private entryCreator(
        meshes: MeshData[],
        callFrom: callFrom,
        codes: string[],
        getExtraFactor: ((material: Material) => number[]) | undefined = undefined
    ): outputType {
        const {groups, usedTextureUvIndices} = this.getMaterialBindGroups(meshes, callFrom, getExtraFactor)
        const pipelineDescriptors = this.getPipelineDescriptors(meshes, usedTextureUvIndices)
        const geometryBindGroup = this.getGeometryBindGroups(meshes)

        return {
            meshes: meshes,
            materialBindGroupLayout: {
                layoutsEntries: SmartRender.defaultMaterialBindGroupLayout,
                primitiveIndex: meshes.map(mesh => mesh.geometry.map(prim => {
                    if (prim.material[`get${callFrom}Texture`]()) {
                        return 0
                    }
                    return 1
                })).flat()
            },
            materialBindGroup: groups,
            geometryBindGroupLayout: {
                entries: SmartRender.defaultGeometryBindGroupLayout,
                primitiveIndex: meshes.map(mesh => mesh.geometry.map(() => 0)).flat()
            },
            pipelineDescriptors,
            shaderCodes: {
                codes,
                primitiveIndex: meshes.map((mesh) => mesh.geometry.map((prim) => {
                    if (prim.material[`get${callFrom}Texture`]()) {
                        return 0
                    }
                    return 1
                })).flat()
            },
            geometryBindGroup: geometryBindGroup
        }
    }

    public base(meshes: MeshData[]): outputType {
        const codes = [
            `struct vsIn{
                    @location(0) pos:vec3f,
                    @location(1) uv:vec2f
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    @location(0) uv:vec2f
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    output.uv=in.uv;
                    return output;
                }
                
                @group(1) @binding(0) var<uniform> factors:vec4f; 
                @group(1) @binding(1) var baseColorTexture : texture_2d<f32>;
                @group(1) @binding(2) var textureSampler:sampler;
                @group(1) @binding(3) var<uniform> alphaMode:vec2f;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    var model=textureSample(baseColorTexture,textureSampler,in.uv);
                    model=model * factors;
                    let alphaValue=model.a;
                    
                    if(i32(alphaMode.r) == 2 && alphaValue < alphaMode.g){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode.r) == 1u);
                    return vec4f(model.xyz,alpha);
                }`, `struct vsIn{
                    @location(0) pos:vec3f,
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    return output;
                }
                
                @group(1) @binding(0) var<uniform> factors:vec4f; 
                @group(1) @binding(1) var<uniform> alphaMode:vec2f;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{

                    let alphaValue=factors.a;
                    
                    if(i32(alphaMode.r) == 2 && alphaValue < alphaMode.y){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode.r) == 1u);
                    return vec4f(factors.xyz,alpha);
            }`
        ]
        return this.entryCreator(meshes, "BaseColor", codes)
    }

    public emissive(meshes: MeshData[]): outputType {
        const codes = [
            `struct vsIn {
    @location(0) pos: vec3f,
    @location(1) uv: vec2f
};

struct vsOut {
    @builtin(position) clipPos: vec4f,
    @location(0) uv: vec2f
};

@group(0) @binding(0) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix: mat4x4<f32>;
@group(2) @binding(0) var<uniform> modelMatrix: mat4x4<f32>;

@vertex fn vs(in: vsIn) -> vsOut {
    var output: vsOut;
    let worldPos = modelMatrix * vec4f(in.pos, 1.0);
    output.clipPos = projectionMatrix * viewMatrix * worldPos;
    output.uv = in.uv;
    return output;
}

@group(1) @binding(0) var<uniform> factors: vec4f;
@group(1) @binding(1) var emissiveTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    let emissiveRGB = factors.xyz * factors.w;
    let emissiveFactor = vec4f(emissiveRGB, 1.0);
    var model = textureSample(emissiveTexture, textureSampler, in.uv);
    model = model * emissiveFactor;

    let alphaValue = model.a;
    let alphaCutOff = alphaMode.y;

    if (i32(alphaMode.x) == 2 && alphaValue < alphaCutOff) {
        discard;
    }

    let alpha = select(1.0, alphaValue, u32(alphaMode.x) == 1u);
    return vec4f(model.xyz, alpha);
}
`,
            `struct vsIn {
    @location(0) pos: vec3f
};

struct vsOut {
    @builtin(position) clipPos: vec4f
};

@group(0) @binding(0) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix: mat4x4<f32>;
@group(2) @binding(0) var<uniform> modelMatrix: mat4x4<f32>;

@vertex fn vs(in: vsIn) -> vsOut {
    var output: vsOut;
    let worldPos = modelMatrix * vec4f(in.pos, 1.0);
    output.clipPos = projectionMatrix * viewMatrix * worldPos;
    return output;
}

@group(1) @binding(0) var<uniform> factors: vec4f;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    let emissiveRGB = factors.xyz * factors.w;
    let emissiveFactor = vec4f(emissiveRGB, 1.0);

    let alphaValue = emissiveFactor.a;
    let alphaCutOff = alphaMode.y;

    if (i32(alphaMode.x) == 2 && alphaValue < alphaCutOff) {
        discard;
    }

    let alpha = select(1.0, alphaValue, u32(alphaMode.x) == 1u);
    return vec4f(emissiveFactor.xyz, alpha);
}
`
        ]

        return this.entryCreator(meshes, "Emissive", codes, (material) => {
            const emissiveExtension = material.getExtension<EmissiveStrength>("KHR_materials_emissive_strength")

            if (emissiveExtension) {
                return [emissiveExtension.getEmissiveStrength()]
            }
            return [1]
        })
    }
}