import {Extension, Material, TypedArray, vec2} from "@gltf-transform/core";
import {vec3} from "gl-matrix";

export type PipelineListItem = {
    hash: number,
    pipeline: GPURenderPipeline,
    layoutHash: number
}

export type PipelineLayoutListItem = {
    hash: number,
    layout: GPUPipelineLayout,
}
export type ShaderModuleListItem = {
    hash: number,
    module: GPUShaderModule,
}

export type BindGroupLayoutListItem = {
    hash: number,
    layout: GPUBindGroupLayout,
}
export type BindGroupListItem = {
    hash: number,
    bindGroup: GPUBindGroup,
}
export type bufferConvertFunc = (device: GPUDevice, data: TypedArray, usage: GPUBufferUsageFlags, label: string) => GPUBuffer
export type textureConvertFunc = (device: GPUDevice, size: vec2 | vec3, data: TypedArray) => Promise<GPUTexture>
export type BindGroupEntryCreationType = {
    texture?: GPUTexture,
    typedArray?: {
        conversion: bufferConvertFunc | textureConvertFunc,
        data: ((material: Material, extensions: Extension[]) => TypedArray) | TypedArray,
    } & ({
        conversionType: "texture",
        size: vec2 | vec3
    } | {
        conversionType: "buffer",
        label: string,
        usage: GPUBufferUsageFlags,
    }),
    buffer?: GPUBuffer,
    sampler?: GPUSampler,
    bindingPoint: number,
}

export type CreateBindGroupEntry = {
    creationEntries: BindGroupEntryCreationType[],
    layoutList: BindGroupLayoutListItem[],
    layoutHash: number,
    bindGroupHash: number
    material?: Material,
    extensions?: Extension[],
}
export type RenderState = {
    primitive: GPUPrimitiveState,
    buffers: (GPUVertexBufferLayout & { name: string })[],
    targets: GPUColorTargetState[]
    depthStencil: GPUDepthStencilState
}