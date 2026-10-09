use image::{DynamicImage, ExtendedColorType, ImageEncoder};
use image::codecs::jpeg::JpegEncoder;

use tauri_plugin_dialog::DialogExt;

const TARGET_SIZE: u64 = 10 * 1024 * 1024; // 10MB
const MIN_RESIZE_DIM: u32 = 10; // Smallest allowed dimension after resize

#[derive(Debug, serde::Deserialize)]
pub struct CompressTask {
    pub filename: String,
    #[serde(default)]
    pub data: Vec<u8>,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub index: usize,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct CompressResult {
    pub filename: String,
    pub original_size: u64,
    pub final_size: u64,
    pub status: String,
    pub error: Option<String>,
}

/// 压缩单张图片，返回 (bytes, status)
pub fn compress_single_image(data: &[u8]) -> Result<(Vec<u8>, String), String> {
    let original_size = data.len() as u64;
    if original_size <= TARGET_SIZE {
        return Ok((data.to_vec(), "copied".to_string()));
    }

    let img = image::load_from_memory(data)
        .map_err(|e| format!("解码失败: {}", e))?;

    let format = image::guess_format(data).unwrap_or(image::ImageFormat::Jpeg);

    let result = match format {
        image::ImageFormat::Png => compress_png(&img, data),
        _ => compress_with_quality(&img),
    }?;

    Ok((result, "compressed".to_string()))
}

fn compress_png(img: &DynamicImage, original_data: &[u8]) -> Result<Vec<u8>, String> {
    // For very large PNGs, skip lossless optimization — oxipng typically
    // achieves only 10-30% reduction, so a >50MB PNG will almost certainly
    // still exceed 10MB. Skip directly to JPEG to save time.
    if original_data.len() as u64 > 5 * TARGET_SIZE {
        return compress_with_quality(img);
    }
    if let Ok(optimized) = optimize_png(original_data) {
        if optimized.len() as u64 <= TARGET_SIZE {
            return Ok(optimized);
        }
    }
    compress_with_quality(img)
}

fn optimize_png(data: &[u8]) -> Result<Vec<u8>, String> {
    let options = oxipng::Options::from_preset(3);
    oxipng::optimize_from_memory(data, &options)
        .map_err(|e| format!("PNG 优化失败: {}", e))
}

fn encode_jpeg(raw: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
    encoder.write_image(raw, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG 编码失败: {}", e))?;
    Ok(buffer)
}

fn predict_quality_bound(size_at_85: u64, target: u64) -> u8 {
    if size_at_85 <= target {
        return 95;
    }
    let ratio = size_at_85 as f64 / target as f64;
    let q = 85.0 * (1.0 / ratio).powf(0.7);
    (q as u8).max(1)
}

fn calc_scale_factor(size_at_q1: u64, target: u64, width: u32, height: u32) -> f32 {
    if size_at_q1 <= target {
        return 1.0;
    }
    let ratio = size_at_q1 as f64 / target as f64;
    // 0.95 safety margin accounts for JPEG's imperfect linearity with pixel count
    let scale = (1.0 / ratio).sqrt() * 0.95;
    let min_dim = MIN_RESIZE_DIM as f64 / (width.min(height).max(1) as f64);
    (scale as f32).max(min_dim as f32).min(1.0)
}

fn binary_search_best_quality(
    lo: u8,
    hi: u8,
    raw: &[u8],
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let mut best: Option<Vec<u8>> = None;
    let mut l = lo;
    let mut h = hi;

    while l <= h {
        let mid = ((l as u16 + h as u16) / 2) as u8;
        let encoded = encode_jpeg(raw, width, height, mid)?;
        if (encoded.len() as u64) <= TARGET_SIZE {
            best = Some(encoded);
            if mid == u8::MAX {
                break;
            }
            l = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            h = mid - 1;
        }
    }

    best.ok_or_else(|| "无法压缩到目标大小".to_string())
}

fn compress_with_quality(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let raw = rgb.as_raw();
    let (w, h) = (rgb.width(), rgb.height());

    // Phase 1: Try quality 85 to get a reference measurement.
    let size_85 = encode_jpeg(raw, w, h, 85)?.len() as u64;

    if size_85 <= TARGET_SIZE {
        // Q=85 already fits — search upward for potentially higher quality.
        return binary_search_best_quality(86, 95, raw, w, h)
            .or_else(|_| encode_jpeg(raw, w, h, 85));
    }

    // Phase 2: Q=85 exceeds target. Predict the quality needed and binary search.
    let bound = predict_quality_bound(size_85, TARGET_SIZE);
    let hi = bound.min(84);
    if let Ok(result) = binary_search_best_quality(1, hi, raw, w, h) {
        // The prediction is conservative (low). Probe one quality above
        // and search upward if it fits, to find the true optimum.
        if hi < 84 {
            if let Ok(probe) = encode_jpeg(raw, w, h, hi + 1) {
                if (probe.len() as u64) <= TARGET_SIZE {
                    if let Ok(better) = binary_search_best_quality(hi + 1, 84, raw, w, h) {
                        return Ok(better);
                    }
                }
            }
        }
        return Ok(result);
    }

    // Phase 3: Even Q=1 exceeds target. Calculate required scale and resize once.
    let size_q1 = encode_jpeg(raw, w, h, 1)?.len() as u64;
    let scale = calc_scale_factor(size_q1, TARGET_SIZE, w, h);
    let mut current = img.resize(
        ((w as f32) * scale).max(MIN_RESIZE_DIM as f32) as u32,
        ((h as f32) * scale).max(MIN_RESIZE_DIM as f32) as u32,
        image::imageops::FilterType::Triangle,
    );

    // Safety loop: extremely rare edge case where the calculated scale is
    // insufficient (e.g., highly detailed texture that resists compression).
    for _ in 0..4 {
        let crgb = current.to_rgb8();
        if let Ok(result) = binary_search_best_quality(
            1,
            85,
            crgb.as_raw(),
            crgb.width(),
            crgb.height(),
        ) {
            return Ok(result);
        }
        let q1_size = encode_jpeg(crgb.as_raw(), crgb.width(), crgb.height(), 1)?.len() as u64;
        let s = calc_scale_factor(q1_size, TARGET_SIZE, crgb.width(), crgb.height());
        current = current.resize(
            ((crgb.width() as f32) * s).max(MIN_RESIZE_DIM as f32) as u32,
            ((crgb.height() as f32) * s).max(MIN_RESIZE_DIM as f32) as u32,
            image::imageops::FilterType::Triangle,
        );
    }

    // Fallback: output at Q=1 with whatever dimensions we have.
    let final_rgb = current.to_rgb8();
    encode_jpeg(final_rgb.as_raw(), final_rgb.width(), final_rgb.height(), 1)
}

#[tauri::command]
pub async fn compress_images(
    files: Vec<CompressTask>,
    output_dir: String,
) -> Result<Vec<CompressResult>, String> {
    tokio::task::spawn_blocking(move || process_images_sync(files, &output_dir))
        .await
        .map_err(|e| format!("压缩任务中断: {}", e))?
}

fn process_images_sync(
    files: Vec<CompressTask>,
    output_dir: &str,
) -> Result<Vec<CompressResult>, String> {
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("无法创建输出目录: {}", e))?;

    // Process files one at a time to bound memory usage.
    // A batch of large images (e.g. 4×20MB JPEGs) can each decode to
    // 70-100MB of raw pixels — processing them in parallel via rayon
    // would allocate 300-400MB simultaneously and OOM the process.
    let results: Vec<CompressResult> = files
        .iter()
        .map(|task| {
            let stem = std::path::Path::new(&task.filename)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let seq = if task.index > 0 { task.index } else { 1 };
            let output_filename = format!("{}_{}.jpg", seq, stem);
            let output_path = std::path::Path::new(output_dir).join(&output_filename);

            // Read image data from filesystem path when available (avoids IPC transfer),
            // otherwise fall back to the inline bytes.
            let image_data = if !task.path.is_empty() {
                match std::fs::read(&task.path) {
                    Ok(d) => d,
                    Err(e) => {
                        return CompressResult {
                            filename: task.filename.clone(),
                            original_size: 0,
                            final_size: 0,
                            status: "failed".to_string(),
                            error: Some(format!("读取文件失败: {}", e)),
                        };
                    }
                }
            } else {
                task.data.clone()
            };
            let original_size = image_data.len() as u64;

            match compress_single_image(&image_data) {
                Ok((data, status)) => {
                    match std::fs::write(&output_path, &data) {
                        Ok(_) => CompressResult {
                            filename: task.filename.clone(),
                            original_size,
                            final_size: data.len() as u64,
                            status,
                            error: None,
                        },
                        Err(e) => CompressResult {
                            filename: task.filename.clone(),
                            original_size,
                            final_size: 0,
                            status: "failed".to_string(),
                            error: Some(format!("写入失败 {}: {}", output_filename, e)),
                        },
                    }
                }
                Err(e) => CompressResult {
                    filename: task.filename.clone(),
                    original_size,
                    final_size: 0,
                    status: "failed".to_string(),
                    error: Some(e),
                },
            }
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub async fn pick_output_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app.dialog().file().blocking_pick_folder();
    match path {
        Some(p) => {
            let path_buf = p.into_path().map_err(|e| format!("路径转换失败: {}", e))?;
            Ok(Some(path_buf.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_jpeg(width: u32, height: u32, quality: u8) -> Vec<u8> {
        let img = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([
                ((x.wrapping_mul(7)).wrapping_add(y.wrapping_mul(13)) % 256) as u8,
                ((x.wrapping_mul(11)).wrapping_add(y.wrapping_mul(17)) % 256) as u8,
                ((x.wrapping_mul(13)).wrapping_add(y.wrapping_mul(7)) % 256) as u8,
            ])
        });
        let mut buf = Vec::new();
        let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
        encoder.write_image(
            img.as_raw(),
            width,
            height,
            ExtendedColorType::Rgb8,
        ).unwrap();
        buf
    }

    #[test]
    fn test_small_image_copied() {
        let data = create_test_jpeg(100, 100, 90);
        assert!(data.len() as u64 <= TARGET_SIZE);
        let (result, status) = compress_single_image(&data).unwrap();
        assert_eq!(result, data);
        assert_eq!(status, "copied");
    }

    #[test]
    fn test_large_jpeg_gets_compressed() {
        let data = create_test_jpeg(3000, 3000, 100);
        assert!(data.len() as u64 > TARGET_SIZE, "expected >10MB but got {}", data.len());
        let (result, status) = compress_single_image(&data).unwrap();
        assert!(result.len() as u64 <= TARGET_SIZE, "expected <=10MB but got {}", result.len());
        assert_eq!(status, "compressed");
    }

    #[test]
    fn test_predict_quality_bound_fits_at_85() {
        // Q=85 already fits — should return upper bound 95
        assert_eq!(predict_quality_bound(5 * 1024 * 1024, TARGET_SIZE), 95);
        assert_eq!(predict_quality_bound(10 * 1024 * 1024, TARGET_SIZE), 95);
    }

    #[test]
    fn test_predict_quality_bound_moderate() {
        // Q=85 is ~25MB, target 10MB, ratio=2.5
        // q = 85 * (1/2.5)^0.7 ≈ 85 * 0.527 ≈ 45
        let est = predict_quality_bound(25 * 1024 * 1024, TARGET_SIZE);
        assert!(est >= 35 && est <= 55, "expected 35-55, got {}", est);
    }

    #[test]
    fn test_predict_quality_bound_severe() {
        // Q=85 is ~100MB, target 10MB, ratio=10
        // q = 85 * (1/10)^0.65 ≈ 85 * 0.224 ≈ 19
        let est = predict_quality_bound(100 * 1024 * 1024, TARGET_SIZE);
        assert!(est >= 5 && est <= 35, "expected 5-35, got {}", est);
    }

    #[test]
    fn test_predict_quality_bound_minimum() {
        // Extremely large — should return at least 1
        let est = predict_quality_bound(500 * 1024 * 1024, TARGET_SIZE);
        assert!(est >= 1, "expected >=1, got {}", est);
    }

    #[test]
    fn test_binary_search_finds_highest_quality() {
        // 100x100 JPEG at quality 95 with random noise (hard to compress)
        let img = image::RgbImage::from_fn(100, 100, |x, y| {
            image::Rgb([
                ((x.wrapping_mul(7)).wrapping_add(y.wrapping_mul(13)) % 256) as u8,
                ((x.wrapping_mul(11)).wrapping_add(y.wrapping_mul(17)) % 256) as u8,
                ((x.wrapping_mul(13)).wrapping_add(y.wrapping_mul(7)) % 256) as u8,
            ])
        });
        let raw = img.as_raw();
        // 100x100 random noise at Q=95 is well under 10MB, so best quality should be 95
        let result = binary_search_best_quality(1, 95, raw, 100, 100).unwrap();
        assert!(result.len() as u64 <= TARGET_SIZE);
        // Verify maximizing: result should equal encoding directly at Q=95
        let q95 = encode_jpeg(raw, 100, 100, 95).unwrap();
        assert_eq!(result.len(), q95.len(), "binary search should find Q=95 as optimal");
    }

    #[test]
    fn test_calc_scale_factor_exact() {
        // 20MB at Q=1, target 10MB, ratio=2.0
        // scale = sqrt(1/2.0) * 0.95 ≈ 0.671
        let scale = calc_scale_factor(20 * 1024 * 1024, TARGET_SIZE, 2000, 2000);
        assert!(scale > 0.6 && scale < 0.75, "expected ~0.67, got {}", scale);
    }

    #[test]
    fn test_calc_scale_factor_already_fits() {
        let scale = calc_scale_factor(5 * 1024 * 1024, TARGET_SIZE, 2000, 2000);
        assert_eq!(scale, 1.0);
    }

    #[test]
    fn test_calc_scale_factor_clamped_to_min() {
        // Tiny image at enormous size — scale should be clamped by min dimension
        let scale = calc_scale_factor(100 * 1024 * 1024, TARGET_SIZE, 20, 20);
        // min_dim = 10 / 20 = 0.5
        assert!(scale >= 0.5, "scale {} should be >= min_dim 0.5", scale);
    }

    #[test]
    fn test_binary_search_no_quality_fits() {
        // Large image where even Q=1 exceeds target — should return Err
        let img = image::RgbImage::from_fn(5000, 5000, |x, y| {
            image::Rgb([
                ((x.wrapping_mul(7)).wrapping_add(y.wrapping_mul(13)) % 256) as u8,
                ((x.wrapping_mul(11)).wrapping_add(y.wrapping_mul(17)) % 256) as u8,
                ((x.wrapping_mul(13)).wrapping_add(y.wrapping_mul(7)) % 256) as u8,
            ])
        });
        let raw = img.as_raw();
        // 5000x5000 random noise at Q=1 — likely still exceeds 10MB
        let result = binary_search_best_quality(1, 1, raw, 5000, 5000);
        match result {
            Ok(encoded) => {
                // If Q=1 somehow fits, verify it's within target
                assert!(encoded.len() as u64 <= TARGET_SIZE);
            }
            Err(e) => {
                // Expected path: Q=1 exceeds target for 5000x5000 random noise
                assert!(!e.is_empty(), "error message should be non-empty");
            }
        }
    }

    #[test]
    fn test_large_png_skips_oxipng() {
        // Create a PNG larger than 5 * TARGET_SIZE (50MB) that definitely needs JPEG
        let img = image::RgbImage::from_fn(5000, 4000, |x, y| {
            image::Rgb([
                ((x.wrapping_mul(7)).wrapping_add(y.wrapping_mul(13)) % 256) as u8,
                ((x.wrapping_mul(11)).wrapping_add(y.wrapping_mul(17)) % 256) as u8,
                ((x.wrapping_mul(13)).wrapping_add(y.wrapping_mul(7)) % 256) as u8,
            ])
        });
        let mut png_data = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        encoder
            .write_image(
                img.as_raw(),
                5000,
                4000,
                image::ExtendedColorType::Rgb8,
            )
            .unwrap();
        // This PNG should be well over 50MB
        assert!(png_data.len() as u64 > 5 * TARGET_SIZE);

        // compress_single_image should handle it (via compress_with_quality JPEG path)
        let (result, status) = compress_single_image(&png_data).unwrap();
        assert!(result.len() as u64 <= TARGET_SIZE);
        assert_eq!(status, "compressed");
    }

    #[test]
    fn test_small_png_copied_as_is() {
        // Small PNG within TARGET_SIZE — early-copy path returns original bytes
        let img = image::RgbImage::from_fn(10, 10, |_, _| image::Rgb([128, 128, 128]));
        let mut png_data = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        encoder
            .write_image(img.as_raw(), 10, 10, image::ExtendedColorType::Rgb8)
            .unwrap();
        assert!(png_data.len() as u64 <= TARGET_SIZE);

        let (result, status) = compress_single_image(&png_data).unwrap();
        assert_eq!(result, png_data);
        assert_eq!(status, "copied");
    }
}
