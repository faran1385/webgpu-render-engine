import {BaseLayer} from "../../../layers/baseLayer.ts";
import {
    BindGroupEntryCreationType,
    BindGroupLayoutListItem,
    BindGroupListItem, bufferConvertFunc,
    CreateBindGroupEntry,
    PipelineLayoutListItem,
    PipelineListItem,
    RenderState,
    ShaderModuleListItem, textureConvertFunc
} from "./GPUCacheTypes.ts";
import {Extension, Material} from "@gltf-transform/core";

export class GPUCache extends BaseLayer {
    static readonly pipelineList: PipelineListItem[] = [];
    static readonly pipelineLayoutList: PipelineLayoutListItem[] = [];
    static readonly shaderModuleList: ShaderModuleListItem[] = [];
    static readonly bindGroupLayoutList: BindGroupLayoutListItem[] = [];
    static readonly materialBindGroupList: BindGroupListItem[] = [];

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    public appendPipeline(
        renderState: RenderState,
        pipelineHash: number,
        pipelineLayoutHash: number,
        shaderModuleHash: number
    ) {
        const alreadyExists = GPUCache.pipelineList.some((item) => item.hash === pipelineHash && pipelineLayoutHash === item.layoutHash);
        if (!alreadyExists) {
            const pipelineLayout = GPUCache.pipelineLayoutList.find((item) => item.hash === pipelineLayoutHash) as PipelineLayoutListItem;
            const shaderModule = GPUCache.shaderModuleList.find((item) => item.hash === shaderModuleHash) as ShaderModuleListItem;

            GPUCache.pipelineList.push({
                hash: pipelineHash,
                pipeline: this.device.createRenderPipeline({
                    primitive: renderState.primitive,
                    vertex: {
                        entryPoint: 'vs',
                        module: shaderModule.module,
                        buffers: renderState.buffers
                    },
                    fragment: {
                        entryPoint: 'fs',
                        module: shaderModule.module,
                        targets: renderState.targets
                    },
                    depthStencil: renderState.depthStencil,
                    layout: pipelineLayout.layout,
                }),
                layoutHash: pipelineLayoutHash
            })
        }
    }

    public appendPipelineLayout(pipelineLayoutHash: number, materialLayoutHash: number, geometryLayoutHash: number) {
        const alreadyExists = GPUCache.pipelineLayoutList.some((item) => item.hash === pipelineLayoutHash);

        if (!alreadyExists) {
            const materialLayout = GPUCache.bindGroupLayoutList.find((item) => item.hash === materialLayoutHash) as BindGroupLayoutListItem;
            const geometryLayout = GPUCache.bindGroupLayoutList.find((item) => item.hash === geometryLayoutHash) as BindGroupLayoutListItem;
            GPUCache.pipelineLayoutList.push({
                hash: pipelineLayoutHash,
                layout: this.device.createPipelineLayout({
                    label: `pipeline layout ${pipelineLayoutHash}`,
                    bindGroupLayouts: [GPUCache.globalBindGroup.layout, materialLayout.layout, geometryLayout.layout]
                })
            })
        }
    }

    public appendShaderModule(code: string, shaderHash: number) {
        const alreadyExists = GPUCache.shaderModuleList.some((item) => item.hash === shaderHash);
        if (!alreadyExists) {
            GPUCache.shaderModuleList.push({
                hash: shaderHash,
                module: this.device.createShaderModule({
                    label: `module ${shaderHash}`,
                    code
                })
            })
        }
    }

    public appendBindGroupLayout(entries: GPUBindGroupLayoutEntry[], layoutHash: number) {
        const alreadyExists = GPUCache.bindGroupLayoutList.some((layout) => layout.hash === layoutHash);
        if (!alreadyExists) {
            GPUCache.bindGroupLayoutList.push({
                layout: this.device.createBindGroupLayout({
                    label: `layout ${layoutHash}`,
                    entries
                }),
                hash: layoutHash
            })
        }
    }

    protected async getEntries(creationEntries: BindGroupEntryCreationType[], material: Material | undefined, extensions: Extension[] | undefined) {

        const entries: GPUBindGroupEntry[] = await Promise.all(creationEntries.map(async (entry) => {
            if (entry.texture) {
                return {
                    binding: entry.bindingPoint,
                    resource: entry.texture.createView(),
                }
            } else if (entry.buffer) {
                return {
                    binding: entry.bindingPoint,
                    resource: {
                        buffer: entry.buffer
                    }
                }
            } else if (entry.sampler) {
                return {
                    binding: entry.bindingPoint,
                    resource: entry.sampler
                }
            } else if (entry.typedArray) {
                const {conversion, data} = entry.typedArray;

                let convertedData: GPUBuffer | GPUTexture;
                const resolvedData = typeof data === 'function'
                    ? data(material as Material, extensions as Extension[])
                    : data;


                if ("usage" in entry.typedArray) {
                    convertedData = (conversion as bufferConvertFunc)(this.device, resolvedData, entry.typedArray.usage, entry.typedArray.label);
                } else if ("size" in entry.typedArray) {
                    if (!entry.typedArray.size) throw new Error("Size is required for texture creation");
                    if (!entry.typedArray.size) throw new Error("Size is required for texture creation");
                    convertedData = await (conversion as textureConvertFunc)(this.device, entry.typedArray.size, resolvedData);
                } else {
                    throw new Error(`Unknown conversionType`);
                }

                if (convertedData instanceof GPUTexture) {
                    return {
                        binding: entry.bindingPoint,
                        resource: convertedData.createView()
                    }
                } else {
                    return {
                        binding: entry.bindingPoint,
                        resource: {
                            buffer: convertedData
                        }
                    }
                }
            } else {
                throw new Error("in order to create bindGroup you need to specify an texture | sampler | typedArray | buffer")
            }
        }))

        return entries
    }

    protected async createBindGroup({
                                        layoutList,
                                        extensions,
                                        creationEntries,
                                        material,
                                        layoutHash,
                                        bindGroupHash,
                                    }: CreateBindGroupEntry) {
        const layout = layoutList.find(item => item.hash === layoutHash)?.layout as GPUBindGroupLayout;
        const entries = await this.getEntries(creationEntries, material, extensions);

        return this.device.createBindGroup({
            label: `bindgroup ${bindGroupHash}`,
            entries,
            layout
        })
    }

    public async appendMaterialBindGroup(
        entries: BindGroupEntryCreationType[],
        bindGroupHash: number, layoutHash: number,
        material: Material,
        extensions: Extension[]
    ) {
        const alreadyExists = GPUCache.materialBindGroupList.some((item) => item.hash === bindGroupHash);
        if (!alreadyExists) {

            const bindGroup = await this.createBindGroup({
                creationEntries: entries,
                layoutList: GPUCache.bindGroupLayoutList,
                layoutHash,
                bindGroupHash,
                material,
                extensions
            })
            GPUCache.materialBindGroupList.push({
                bindGroup,
                hash: bindGroupHash
            })
        }
    }


    public getGeometryLayout(geometryBindGroupLayoutHash: number) {
        return (GPUCache.bindGroupLayoutList.find(item => item.hash === geometryBindGroupLayoutHash) as BindGroupLayoutListItem).layout
    }

    public getRenderSetup(pipelineHash: number, pipelineLayout: number, materialBindGroupHash: number, materialBindGroupLayoutHash: number, geometryBindGroupLayoutHash: number, shaderCodeHash: number) {
        return {
            pipeline: (GPUCache.pipelineList.find(item => item.hash === pipelineHash) as PipelineListItem).pipeline,
            pipelineLayout: (GPUCache.pipelineLayoutList.find(item => item.hash === pipelineLayout) as PipelineLayoutListItem).layout,
            materialBindGroup: (GPUCache.materialBindGroupList.find(item => item.hash === materialBindGroupHash) as BindGroupListItem).bindGroup,
            materialBindGroupLayout: (GPUCache.bindGroupLayoutList.find(item => item.hash === materialBindGroupLayoutHash) as BindGroupLayoutListItem).layout,
            geometryBindGroupLayout: (GPUCache.bindGroupLayoutList.find(item => item.hash === geometryBindGroupLayoutHash) as BindGroupLayoutListItem).layout,
            shaderModule: (GPUCache.shaderModuleList.find(item => item.hash === shaderCodeHash) as ShaderModuleListItem).module,
        }
    }
}