
export const vs = `
[[block]] struct Uniforms {
  [[offset(0)]] modelViewProjectionMatrix : mat4x4<f32>;
};

[[binding(0), set(0)]] var<uniform> uniforms : Uniforms;

[[location(0)]] var<in> position : vec4<f32>;
[[location(1)]] var<in> color : vec4<f32>;

[[builtin(position)]] var<out> Position : vec4<f32>;
[[location(0)]] var<out> fragColor : vec4<f32>;

[[stage(vertex)]]
fn main() -> void {
	Position = uniforms.modelViewProjectionMatrix * position;
	fragColor = color;
	return;
}
`;

export const fs = `
[[location(0)]] var<in> fragColor : vec4<f32>;
[[location(0)]] var<out> outColor : vec4<f32>;

[[stage(fragment)]]
fn main() -> void {
	outColor = fragColor;
	return;
}
`;

export let csTest = `

[[block]] struct Positions {
	[[offset(0)]] values : [[stride(16)]] array<vec4<f32>>;
};

[[block]] struct Colors {
	[[offset(0)]] values : [[stride(16)]] array<vec4<f32>>;
};

[[binding(0), set(0)]] var<storage_buffer> positions : Positions;
[[binding(1), set(0)]] var<storage_buffer> colors : Colors;

[[builtin(global_invocation_id)]] var<in> GlobalInvocationID : vec3<u32>;

[[stage(compute)]]
fn main() -> void{

	var index : u32 = GlobalInvocationID.x;

	if(index > 100 * 1000){
		return;
	}

	var i_pos : u32 = (index * 3u) / 4u;
	if(index % 4u == 0){
		positions.values[i_pos].x = 0.0;
	}elseif(index % 4u == 1){
		positions.values[i_pos].w = 0.0;
	}elseif(index % 4u == 2){
		positions.values[i_pos].z = 0.0;
	}elseif(index % 4u == 3){
		positions.values[i_pos].y = 0.0;
	}


	colors.values[index].x = 1.0;

	#points.position[index + 1].x = 1.0;
	#points.position[index + 1].y = 0.0;
	#points.position[index + 1].z = 1.0;


	return;
}

`;

export let csLasToVBO = `

[[block]] struct LasData {
	[[offset(0)]] values : [[stride(4)]] array<u32>;
};

[[block]] struct Positions {
	[[offset(0)]] values : [[stride(4)]] array<f32>;
};

[[block]] struct Colors {
	[[offset(0)]] values : [[stride(16)]] array<vec4<f32>>;
};

[[binding(0), set(0)]] var<storage_buffer> lasdata : LasData;
[[binding(1), set(0)]] var<storage_buffer> positions : Positions;
[[binding(2), set(0)]] var<storage_buffer> colors : Colors;

[[builtin(global_invocation_id)]] var<in> GlobalInvocationID : vec3<u32>;

var<private> recordLength : u32 = 26u;

fn readU32(byteOffset : u32) -> u32{

	var b0SourceIndex : u32 = (byteOffset + 0) / 4u;
	var b1SourceIndex : u32 = (byteOffset + 1) / 4u;
	var b2SourceIndex : u32 = (byteOffset + 2) / 4u;
	var b3SourceIndex : u32 = (byteOffset + 3) / 4u;

	var result : u32 = 0u;

	
	var overlapCase : u32 = byteOffset % 4u;

	if(overlapCase == 0){
		result = lasdata.values[b0SourceIndex];
	}elseif(overlapCase == 1){
		result = result | lasdata.values[b0SourceIndex] << 8;
		result = result | lasdata.values[b0SourceIndex + 1] >> 24;
	}elseif(overlapCase == 2){
		result = result | lasdata.values[b0SourceIndex] << 16;
		result = result | lasdata.values[b0SourceIndex + 1] >> 16;
	}elseif(overlapCase == 3){
		result = result | lasdata.values[b0SourceIndex] << 24;
		result = result | lasdata.values[b0SourceIndex + 1] >> 8;
	}

	return result;
}

fn readI32(byteOffset : u32) -> i32{

	var b0SourceIndex : u32 = (byteOffset + 0) / 4u;
	var b1SourceIndex : u32 = (byteOffset + 1) / 4u;
	var b2SourceIndex : u32 = (byteOffset + 2) / 4u;
	var b3SourceIndex : u32 = (byteOffset + 3) / 4u;

	var result : i32 = 0;
	
	var overlapCase : u32 = byteOffset % 4u;

	if(overlapCase == 0){
		result = i32(lasdata.values[b0SourceIndex]);
	}elseif(overlapCase == 1){
		result = result | i32(lasdata.values[b0SourceIndex] << 8);
		result = result | i32(lasdata.values[b0SourceIndex + 1] >> 24);
	}elseif(overlapCase == 2){
		result = result | i32(lasdata.values[b0SourceIndex] << 16);
		result = result | i32(lasdata.values[b0SourceIndex + 1] >> 16);
	}elseif(overlapCase == 3){
		result = result | i32(lasdata.values[b0SourceIndex] << 24);
		result = result | i32(lasdata.values[b0SourceIndex + 1] >> 8);
	}

	return result;
}

[[stage(compute)]]
fn main() -> void{

	var index : u32 = GlobalInvocationID.x;

	if(index > 100 * 1000){
		return;
	}

	var ux : i32 = readI32(index * recordLength + 0);
	var uy : i32 = readI32(index * recordLength + 4);
	var uz : i32 = readI32(index * recordLength + 8);

	var x : f32 = f32(ux) / 100.0;
	var y : f32 = f32(uy) / 100.0;
	var z : f32 = f32(uz) / 100.0;

	positions.values[3 * index + 0] = x;
	positions.values[3 * index + 1] = y;
	positions.values[3 * index + 2] = z;

	return;
}

`;