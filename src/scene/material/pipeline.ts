import {
    GeometryData,
    PipelineFlags,
    RenderSetup,
    SelectiveResource,
    ShaderFlag
} from "../loader/loaderTypes.ts";
import {PipelineManager} from "./pipelineManager.ts";


export class Pipeline extends PipelineManager {
    private pipelineHash!: number;
    private geometryLayoutHash!: number;
    private renderSetup!: RenderSetup;
    private geometryData!: GeometryData;
    private selectiveResource: "ALL" | SelectiveResource[] = 'ALL';
    private shaderCode!: ShaderFlag;
    private modelBuffer!: GPUBuffer;
    private normalBuffer: GPUBuffer | undefined = undefined;

    constructor(
        device: GPUDevice, canvas: HTMLCanvasElement,
        ctx: GPUCanvasContext,
        renderSetup: RenderSetup,
        geometryData: GeometryData,
        shaderFlag: ShaderFlag,
        modelBuffer: GPUBuffer,
        normalBuffer: GPUBuffer | undefined,
        selectiveResource: SelectiveResource[] | undefined = undefined
    ) {
        super(device, canvas, ctx);
        this.renderSetup = renderSetup;
        this.geometryData = geometryData;
        this.selectiveResource = selectiveResource ?? 'ALL'
        this.shaderCode = shaderFlag;
        this.modelBuffer = modelBuffer;
        this.normalBuffer = normalBuffer;
    }


    public init() {
        this.hashPipelineFeatures();
        this.hashGeometryLayout();
        Pipeline.appendGeometryLayoutHash(this.geometryLayoutHash)
        Pipeline.appendPipelineHash(this.pipelineHash, this.geometryLayoutHash, this.renderSetup)

        const entries = [{
            binding: 0,
            resource: {
                buffer: this.modelBuffer,
            }
        }]

        if (this.normalBuffer) {
            entries.push({
                binding: 1,
                resource: {
                    buffer: this.normalBuffer,
                }
            })
        }

        return {
            pipeline: Pipeline.getPipeline(this.pipelineHash, this.renderSetup.materialHash),
            bindGroup: this.device.createBindGroup({
                layout: Pipeline.geometryBindGroupLayoutList.find(item => item.hash === this.geometryLayoutHash)?.layout as GPUBindGroupLayout,
                entries
            })
        }
    }

    private hashGeometryLayout() {
        let hash = 0;

        // hash |= GeometryLayout.NORMAL;


        this.geometryLayoutHash = hash;
    }

    private hashPipelineFeatures() {
        let hash = 0;

        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.ALPHA))) {
            if (this.renderSetup.materialData.alpha.mode === 'OPAQUE') {
                hash |= PipelineFlags.AlphaMode_Opaque;
            } else if (this.renderSetup.materialData.alpha.mode === 'MASK') {
                hash |= PipelineFlags.AlphaMode_MaskOnly;
            } else if (this.renderSetup.materialData.alpha.mode === 'BLEND') {
                hash |= PipelineFlags.AlphaMode_Blend;
            }
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.DOUBLE_SIDED)) && this.renderSetup.materialData.doubleSided) {

            hash |= PipelineFlags.IsDoubleSided;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.UV))) {
            const hasUv = Boolean(this.geometryData.vertex.uv);

            if (hasUv) hash |= PipelineFlags.HasUV;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.NORMAL))) {
            const hasUv = Boolean(this.geometryData.vertex.normal)
            if (hasUv) hash |= PipelineFlags.HasNORMAL;
        }
        if (this.shaderCode === PipelineFlags.BASE) {

            hash |= PipelineFlags.BASE;
        }
        if (this.shaderCode === PipelineFlags.EMISSIVE) {

            hash |= PipelineFlags.EMISSIVE;
        }
        if (this.shaderCode === PipelineFlags.OCCLUSION) {

            hash |= PipelineFlags.OCCLUSION;
        }
        if (this.shaderCode === PipelineFlags.NORMAL) {

            hash |= PipelineFlags.NORMAL;
        }
        if (this.shaderCode === PipelineFlags.METALLIC) {
            hash |= PipelineFlags.METALLIC;
        }
        if (this.shaderCode === PipelineFlags.ROUGHNESS) {

            hash |= PipelineFlags.ROUGHNESS;

        }
        if (this.shaderCode === PipelineFlags.TRANSMISSION) {

            hash |= PipelineFlags.TRANSMISSION;
        }
        if (this.shaderCode === PipelineFlags.GLOSSINESS) {

            hash |= PipelineFlags.GLOSSINESS;
        }
        if (this.shaderCode === PipelineFlags.SPECULAR) {

            hash |= PipelineFlags.SPECULAR;
        }
        if (this.shaderCode === PipelineFlags.OPACITY) {

            hash |= PipelineFlags.OPACITY;
        }
        if (this.shaderCode === PipelineFlags.GLOSSINESS_SPECULAR) {

            hash |= PipelineFlags.GLOSSINESS_SPECULAR;
        }
        if (this.shaderCode === PipelineFlags.SPECULAR_FO) {

            hash |= PipelineFlags.SPECULAR_FO;
        }
        if (this.shaderCode === PipelineFlags.CLEARCOAT_TEXTURE) {

            hash |= PipelineFlags.CLEARCOAT_TEXTURE;
        }
        if (this.shaderCode === PipelineFlags.CLEARCOAT_ROUGHNESS_TEXTURE) {

            hash |= PipelineFlags.CLEARCOAT_ROUGHNESS_TEXTURE;
        }
        if (this.shaderCode === PipelineFlags.CLEARCOAT__NORMAL_TEXTURE) {

            hash |= PipelineFlags.CLEARCOAT__NORMAL_TEXTURE;
        }
        this.pipelineHash = hash;
    }
}