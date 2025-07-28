import {Material} from "./Material.ts";
import {RenderFlag} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {
    MaterialDescriptorGenerator
} from "../GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGenerator.ts";


export class InspectorMaterial extends Material {
    textureRenderFlag: RenderFlag;
    private textureMap = new Map<RenderFlag, GPUTexture>();

    constructor(RenderFlag: RenderFlag) {
        super();
        this.textureRenderFlag = RenderFlag;
    }

    initDescriptor(materialBindGroupGenerator: MaterialDescriptorGenerator) {

    }

    setTexture(texture: GPUTexture, renderFlag: RenderFlag) {
        this.textureMap.set(renderFlag, texture)
    }
}