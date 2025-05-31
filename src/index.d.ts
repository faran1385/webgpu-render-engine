import {MeshData} from "./scene/loader/loader.ts";

declare module "orbit-controls" {
    // Define the types or declare 'any' if you're unsure about the specific types
    const OrbitControls: any;
    export default OrbitControls;
}


// src/globals.d.ts
declare global {
    type To = {
        node: string,
        input: string
    }
    type From = {
        node: string,
        output: string
    }
    type ShaderNodeMix = {
        children: string[],
        parents: string[],
        inputs: {
            A: { value: [number, number, number] } | { from: From },
            B: { value: [number, number, number] } | { from: From },
            Factor: { value: [number, number, number] } | { from: From },
        },
        params: Record<string, string | number>,
        outputs: {
            Result: { value: [number, number, number] },
        },
        name: string,
        type: "ShaderNodeMix"
    }

    type ShaderNodeRGB = {
        inputs: {},
        name: string,
        outputs: {
            Color: {
                to: To[],
                value: [number, number, number, number],
            },
        },
        type: "ShaderNodeRGB"
    }

    type ShaderNodeEmission = {
        inputs: {
            Color: { value: [number, number, number] } | { from: From },
            Strength: { value: number } | { from: From },
            Weight: { value: number } | { from: From },

        },
        name: string,
        outputs: {
            Emission: {
                to: To[],
            },
        },
        type: "ShaderNodeEmission"
    }

    type ShaderNodeOutputMaterial = {
        inputs: {
            Displacement: { value: [number, number, number] } | { from: From },
            Surface: { value: [number, number, number] } | { from: From },
            Thickness: { value: number } | { from: From },
            Volume: { value: number | null } | { from: From },
        },
        name: string,
        outputs: {},
        type: "ShaderNodeOutputMaterial"
    }

    type ShaderNodeValue = {
        inputs: {},
        name: string,
        outputs: {
            Value: { value: number }
        },
        type: "ShaderNodeValue"
    }

    type nodeType =
        "ShaderNodeMix"
        | "ShaderNodeRGB"
        | "ShaderNodeEmission"
        | "ShaderNodeOutputMaterial"
        | "ShaderNodeValue"
        | "ShaderNodeAddShader"

    type node = ShaderNodeRGB | ShaderNodeMix | ShaderNodeEmission | ShaderNodeOutputMaterial | ShaderNodeValue
}


export {}
