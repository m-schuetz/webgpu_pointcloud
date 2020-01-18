
// based on cube example from https://github.com/cx20/webgpu-test (MIT license)

import {LASLoader} from "./LASLoader.js";

let urlPointcloud = "http://mschuetz.potree.org/lion/lion.las";

// ==========================================
// VERTEX SHADER
// ==========================================

let vs = `
#version 450

layout(set = 0, binding = 0) uniform Uniforms {
	mat4 worldViewProj;
} uniforms;

layout(location = 0) in vec3 position;
layout(location = 1) in vec4 color;

layout(location = 0) out vec4 vColor;

void main() {
	vColor = color;
	gl_Position = uniforms.worldViewProj * vec4(position, 1.0);
}
`;

// ==========================================
// FRAGMENT SHADER
// ==========================================

let fs = `
#version 450

layout(location = 0) in vec4 vColor;
layout(location = 0) out vec4 outColor;

void main() {
	outColor = vColor;
}
`;

// ==========================================
// MAGIC
// ==========================================

let frameCount = 0;
let lastFpsMeasure = 0;

let canvas = null;
let context = null;
let glslang = null;
let gpu = null;
let adapter = null;
let device = null;
let swapChain = null;
let sceneObject = null;
let worldViewProj = mat4.create();
let shader = {
	vsModule: null,
	fsModule: null,
};
let pipeline = null;
let uniformBindGroup = null;
let depthTexture = null;
let uniformBuffer = null;


function configureSwapChain(device, swapChainFormat, context) {
	const swapChainDescriptor = {
		device: device,
		format: swapChainFormat
	};

	return context.configureSwapChain(swapChainDescriptor);
}

function makeShaderModule_GLSL(glslang, device, type, source) {
	let shaderModuleDescriptor = {
		code: glslang.compileGLSL(source, type),
		source: source
	};

	let shaderModule = device.createShaderModule(shaderModuleDescriptor);
	return shaderModule;
}

async function loadPointcloud(url, device){

	let loader = new LASLoader(url);
	await loader.loadHeader();

	let numPoints = loader.header.numPoints;

	// create position and color buffer
	let descriptorPos = {
		size: 12 * numPoints,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	};
	let bufPositions = device.createBuffer(descriptorPos);

	let descriptorCol = {
		size: 16 * numPoints,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	};
	let bufColors = device.createBuffer(descriptorCol);

	let sceneObject = {
		n: 0,
		bufPositions: bufPositions,
		bufColors: bufColors,
	};

	let elProgress = document.getElementById("progress");

	// this async function keeps on loading new data and updating the buffers
	let asyncLoad = async () => {
		let iterator = loader.loadBatches();
		let pointsLoaded = 0;
		for await (let batch of iterator){
			
			bufPositions.setSubData(12 * pointsLoaded, batch.positions);
			bufColors.setSubData(16 * pointsLoaded, batch.colors);
			
			pointsLoaded += batch.size;

			let progress = pointsLoaded / loader.header.numPoints;
			let strProgress = `${parseInt(progress * 100)}`;
			let msg = `loading: ${strProgress}%`;
			elProgress.innerHTML = msg;

			sceneObject.n = pointsLoaded;
		}

		elProgress.innerHTML = `loading finished`;
	};

	asyncLoad();
	
	return sceneObject;
}

async function initRenderer() {
	const glslangModule = await import("https://unpkg.com/@webgpu/glslang@0.0.9/dist/web-devel/glslang.js");
	glslang = await glslangModule.default();

	gpu = navigator['gpu'];
	adapter = await gpu.requestAdapter();
	device = await adapter.requestDevice();

	canvas = document.getElementById('canvas');
	context = canvas.getContext('gpupresent')

	const swapChainFormat = "bgra8unorm";
	swapChain = configureSwapChain(device, swapChainFormat, context);

	shader.vsModule = makeShaderModule_GLSL(glslang, device, 'vertex', vs);
	shader.fsModule = makeShaderModule_GLSL(glslang, device, 'fragment', fs);

	const uniformsBindGroupLayout = device.createBindGroupLayout({
		bindings: [{
			binding: 0,
			visibility: GPUShaderStage.VERTEX,
			type: "uniform-buffer"
		}]
	});

	const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [uniformsBindGroupLayout] });

	pipeline = device.createRenderPipeline({
		layout: pipelineLayout,
		vertexStage: {
			module: shader.vsModule,
			entryPoint: 'main'
		},
		fragmentStage: {
			module: shader.fsModule,
			entryPoint: 'main'
		},
		vertexState: {
			vertexBuffers: [
				{
					arrayStride: 3 * 4,
					attributes: [
						{ // position
							shaderLocation: 0,
							offset: 0,
							format: "float3"
						}
					]
				},{
					arrayStride: 4 * 4,
					attributes: [
						{ // color
							shaderLocation: 1,
							offset: 0,
							format: "float4"
						}
					]
				}
			]
		},
		colorStates: [
			{
				format: swapChainFormat,
				alphaBlend: {
					srcFactor: "src-alpha",
					dstFactor: "one-minus-src-alpha",
					operation: "add"
				}
			}
		],
		primitiveTopology: 'point-list',
		rasterizationState: {
			frontFace: "ccw",
			cullMode: 'none'
		},
		depthStencilState: {
			depthWriteEnabled: true,
			depthCompare: "less",
			format: "depth24plus-stencil8",
		}
	});

	const uniformBufferSize = 4 * 16; // 4x4 matrix

	uniformBuffer = device.createBuffer({
		size: uniformBufferSize,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	uniformBindGroup = device.createBindGroup({
		layout: uniformsBindGroupLayout,
		bindings: [{
			binding: 0,
			resource: {
				buffer: uniformBuffer,
			},
		}],
	});

	depthTexture = device.createTexture({
		size: {
			width: canvas.width,
			height: canvas.height,
			depth: 1
		},
		format: "depth24plus-stencil8",
		usage: GPUTextureUsage.OUTPUT_ATTACHMENT
	});
};

async function initScene(){
	sceneObject = await loadPointcloud(urlPointcloud, device);
}


function update(timestamp){

	{ // update worldViewProj
		let proj = mat4.create();
		let view = mat4.create();

		{ // proj
			const aspect = Math.abs(canvas.width / canvas.height);
			mat4.perspective(proj, 45, aspect, 0.1, 100.0);
		}

		{ // view
			let target = vec3.fromValues(2, 5, 0);
			let r = 5;
			let x = r * Math.sin(timestamp / 1000) + target[0];
			let y = r * Math.cos(timestamp / 1000) + target[1];
			let z = 2;

			let position = vec3.fromValues(x, y, z);
			let up = vec3.fromValues(0, 0, 1);
			mat4.lookAt(view, position, target, up);
		}

		mat4.multiply(worldViewProj, proj, view);
	}

}

function render(timestamp){

	let needsResize = canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight;
	if(needsResize){
		canvas.width = canvas.clientWidth;
		canvas.height = canvas.clientHeight;

		depthTexture = device.createTexture({
			size: {
				width: canvas.width,
				height: canvas.height,
				depth: 1
			},
			format: "depth24plus-stencil8",
			usage: GPUTextureUsage.OUTPUT_ATTACHMENT
		});
	}

	uniformBuffer.setSubData(0, worldViewProj);

	const commandEncoder = device.createCommandEncoder();
	const textureView = swapChain.getCurrentTexture().createView();
	const renderPassDescriptor = {
		colorAttachments: [{
			attachment: textureView,
			loadValue: { r: 0, g: 0, b: 0, a: 0 },
		}],
		depthStencilAttachment: {
			attachment: depthTexture.createView(),
			depthLoadValue: 1.0,
			depthStoreOp: "store",
			stencilLoadValue: 0,
			stencilStoreOp: "store",
		}
	};
	const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
	passEncoder.setPipeline(pipeline);

	if(sceneObject){
		passEncoder.setVertexBuffer(0, sceneObject.bufPositions);
		passEncoder.setVertexBuffer(1, sceneObject.bufColors);
		passEncoder.setBindGroup(0, uniformBindGroup);
		passEncoder.setViewport(0, 0, canvas.width, canvas.height, 0, 1);
		passEncoder.draw(sceneObject.n, 1, 0, 0);
	}

	passEncoder.endPass();
	device.defaultQueue.submit([commandEncoder.finish()]);

	{// compute FPS
		frameCount++;
		let timeSinceLastFpsMeasure = (performance.now() - lastFpsMeasure) / 1000;
		if(timeSinceLastFpsMeasure > 1){
			let fps = frameCount / timeSinceLastFpsMeasure;
			console.log(`fps: ${Math.round(fps)}`);
			lastFpsMeasure = performance.now();
			frameCount = 0;
		}
	}
}

function loop(timestamp){

	update(timestamp);
	render(timestamp);

	requestAnimationFrame(loop);
}

async function run(){

	await initRenderer();
	await initScene();

	loop();

}

run();