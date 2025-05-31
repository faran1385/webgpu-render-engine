import {
    DecodedGeometryLayout,
    DecodedMaterialFlags,
    DecodedPipelineFlags, GeometryLayout,
    PipelineFlags,
    RenderSetup,
} from "../loader/loaderTypes.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {determineShaderCode} from "./shaderCode.ts";

type UniquePipeline = { pipeline: GPURenderPipeline, hash: [number, number] }
type  UniqueGeometryLayout = { layout: GPUBindGroupLayout, hash: number }

export class PipelineManager extends BaseLayer {
    protected static device: GPUDevice;
    private _initialized: boolean = false;
    protected static readonly pipelineHashList: [number, number][] = []
    protected static readonly pipelineList: UniquePipeline[] = []
    protected static readonly geometryLayoutHashList: number[] = []
    protected static geometryBindGroupLayoutList: UniqueGeometryLayout[] = [];

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx)
        if (this.constructor === PipelineManager && !this._initialized) {
            PipelineManager.device = device;
            this._initialized = true;

        }
    }


    protected static decodePipelineHash(hash: number, decodedMaterial: DecodedMaterialFlags): DecodedPipelineFlags {
        const alphaBits = hash & PipelineFlags.AlphaMode_Mask;

        let alphaMode: 'opaque' | 'mask' | 'blend';
        switch (alphaBits) {
            case PipelineFlags.AlphaMode_MaskOnly:
                alphaMode = 'mask';
                break;
            case PipelineFlags.AlphaMode_Blend:
                alphaMode = 'blend';
                break;
            default:
                alphaMode = 'opaque';
        }

        const doubleSided = (hash & PipelineFlags.IsDoubleSided) !== 0;
        const hasUv = (hash & PipelineFlags.HasUV) !== 0;
        const hasNormal = (hash & PipelineFlags.HasNORMAL) !== 0;
        const isBase = (hash & PipelineFlags.BASE) !== 0;
        const isEmissive = (hash & PipelineFlags.EMISSIVE) !== 0;
        const isOcclusion = (hash & PipelineFlags.OCCLUSION) !== 0;
        const isNormal = (hash & PipelineFlags.NORMAL) !== 0;
        const isMetallic = (hash & PipelineFlags.METALLIC) !== 0;
        const isRoughness = (hash & PipelineFlags.ROUGHNESS) !== 0;
        const isTransmission = (hash & PipelineFlags.TRANSMISSION) !== 0;
        const isGlossiness = (hash & PipelineFlags.GLOSSINESS) !== 0;
        const isSpecular = (hash & PipelineFlags.SPECULAR) !== 0;
        const isOpacity = (hash & PipelineFlags.OPACITY) !== 0;
        const isSpecularGlossiness = (hash & PipelineFlags.GLOSSINESS_SPECULAR) !== 0;
        const isSpecularColor = (hash & PipelineFlags.SPECULAR_COLOR) !== 0;
        const isClearcoat = (hash & PipelineFlags.CLEARCOAT_TEXTURE) !== 0;
        const isClearcoatRoughness = (hash & PipelineFlags.CLEARCOAT_ROUGHNESS_TEXTURE) !== 0;
        const isClearcoatNormal = (hash & PipelineFlags.CLEARCOAT__NORMAL_TEXTURE) !== 0;


        return {
            doubleSided,
            alphaMode,
            hasUv,
            hasNormal,
            shaderCode:determineShaderCode({
                isBase,
                hasUv,
                isRoughness,
                isMetallic,
                isTransmission,
                isSpecular,
                isGlossiness,
                isOcclusion,
                isNormal,
                isEmissive,
                decodedMaterial,
                isOpacity,
                isSpecularGlossiness,
                isSpecularColor,
                isClearcoat,
                isClearcoatRoughness,
                isClearcoatNormal
            })
        };
    }

    protected static createRenderPipeline(hash: number, geometryLayoutHash: number, renderSetup: RenderSetup) {
        const decodedPipeline = this.decodePipelineHash(hash, renderSetup.decodedMaterial);
        const layout = this.geometryBindGroupLayoutList.find(item => item.hash === geometryLayoutHash)?.layout as GPUBindGroupLayout;

        const shaderModule = this.device.createShaderModule({
            code: decodedPipeline.shaderCode
        });
        const buffers: GPUVertexBufferLayout[] = [{
            arrayStride: 3 * 4,
            attributes: [{
                offset: 0,
                shaderLocation: 0,
                format: "float32x3"
            }]
        }];

        if (decodedPipeline.hasUv) {
            buffers.push({
                arrayStride: 2 * 4,
                attributes: [{
                    offset: 0,
                    shaderLocation: 1,
                    format: "float32x2"
                }]
            })
        }

        if (decodedPipeline.hasNormal) {
            buffers.push({
                arrayStride: 3 * 4,
                attributes: [{
                    offset: 0,
                    shaderLocation: 2,
                    format: "float32x3"
                }]
            })
        }

        this.pipelineList.push({
            hash: [hash, renderSetup.materialHash],
            pipeline: this.device.createRenderPipeline({
                label: `pipeline ${hash}`,
                vertex: {
                    entryPoint: 'vs',
                    module: shaderModule,
                    buffers
                },
                fragment: {
                    entryPoint: "fs",
                    module: shaderModule,
                    targets: [{
                        format: PipelineManager._format,
                        blend: decodedPipeline.alphaMode === "blend" ? {
                            color: {
                                srcFactor: "src-alpha",
                                dstFactor: "one-minus-src-alpha",
                                operation: "add"
                            },
                            alpha: {
                                srcFactor: "one",
                                dstFactor: "one-minus-src-alpha",
                                operation: "add"
                            }
                        } : undefined,
                        writeMask: GPUColorWrite.ALL
                    }]
                },
                primitive: {
                    cullMode: decodedPipeline.doubleSided ? "none" : "back",
                    topology: "triangle-list"
                },
                depthStencil: {
                    depthCompare: "less",
                    depthWriteEnabled: decodedPipeline.alphaMode !== 'blend',
                    format: "depth24plus"
                },
                layout: this.device.createPipelineLayout({
                    label: `pipeline layout ${hash}`,
                    bindGroupLayouts: [this.globalBindGroup.layout, renderSetup.layout, layout]
                })
            })
        })
    }

    protected static getPipeline(hash: number, materialHash: number) {
        return (PipelineManager.pipelineList.find((item) => item.hash[0] === hash && item.hash[1] === materialHash) as UniquePipeline).pipeline
    }


    protected static appendPipelineHash(hash: number, geometryLayoutHash: number, renderSetup: RenderSetup) {
        const alreadyExist: boolean = this.pipelineHashList.some(item => item[0] === hash && item[1] === renderSetup.materialHash);
        if (!alreadyExist) {
            this.pipelineHashList.push([hash, renderSetup.materialHash]);
            this.createRenderPipeline(hash, geometryLayoutHash, renderSetup);
        }
    }

    protected static decodeGeometryLayoutHash(hash: number): DecodedGeometryLayout {
        const hasNormal = (hash & GeometryLayout.NORMAL) !== 0;

        return {
            hasNormal,
        }
    }

    protected static createGeometryLayout(hash: number) {
        const decoded = this.decodeGeometryLayoutHash(hash);
        const entries: GPUBindGroupLayoutEntry[] = [{
            binding: 0,
            buffer: {
                type: "uniform"
            },
            visibility: GPUShaderStage.VERTEX
        }]

        if (decoded.hasNormal) entries.push({
            binding: 0,
            buffer: {
                type: "uniform"
            },
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
        })

        this.geometryBindGroupLayoutList.push({
            hash,
            layout: this.device.createBindGroupLayout({
                label: `geometry layout ${hash}`,
                entries
            })
        })
    }

    protected static appendGeometryLayoutHash(hash: number) {
        const alreadyExist: boolean = this.geometryBindGroupLayoutList.some(item => item.hash === hash);
        if (!alreadyExist) {
            this.geometryLayoutHashList.push(hash);
            this.createGeometryLayout(hash);
        }
    }
}