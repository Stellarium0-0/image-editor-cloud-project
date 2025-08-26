import React, { useState, useEffect, useCallback, ChangeEvent } from 'react';
import api from '../services/api';
import AuthenticatedImage from './AuthenticatedImage';

// --- (Interfaces remain the same) ---
interface ImageMetadata {
  unique_filename: string;
  original_filename: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  processed_versions: string[];
  tags: string[];
  user: string;
}

interface PaginatedImagesResponse {
  images: ImageMetadata[];
}

interface DashboardPageProps {
  username: string | null;
  onLogout: () => void;
}

interface ActivePreviews {
  [key: string]: string;
}

interface SelectedEffects {
  [key: string]: string;
}

// CORRECTED: This list now matches the actual effects in your backend
const availableEffects = [
  'sharpen', 'composite', 'tint', 'negate', 'convolve', 'median', 'recomb', 
  'fractal_noise', 'chromatic_aberration', 'oil_painting', 'holographic', 
  'edge_enhance_extreme', 'vortex', 'plasma', 'aurora'
];

function DashboardPage({ username, onLogout }: DashboardPageProps) {
  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string>('');
  const [activePreviews, setActivePreviews] = useState<ActivePreviews>({});
  const [selectedEffects, setSelectedEffects] = useState<SelectedEffects>({});

  const fetchImages = useCallback(async () => {
    try {
      const response = await api.get<PaginatedImagesResponse>('/images');
      const initialPreviews: ActivePreviews = {};
      const initialEffects: SelectedEffects = {};

      response.data.images.forEach(img => {
        const latestVersion = img.processed_versions.length > 0
          ? img.processed_versions[img.processed_versions.length - 1]
          : img.unique_filename;
        initialPreviews[img.unique_filename] = latestVersion;
        initialEffects[img.unique_filename] = availableEffects[0];
      });

      setImages(response.data.images);
      setActivePreviews(initialPreviews);
      setSelectedEffects(initialEffects);
    } catch (error) {
      console.error('Failed to fetch images:', error);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
  };
  
  const handleDelete = async (uniqueFilename: string) => {
    if (!window.confirm("Are you sure you want to delete this image and all its processed versions?")) {
      return;
    }
    try {
      await api.delete(`/images/${uniqueFilename}`);
      fetchImages();
    } catch (error) {
      console.error("Failed to delete image:", error);
      setMessage("Failed to delete image.");
    }
  };

  // --- ADDED MISSING CODE ---
  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage('Please select a file to upload.');
      return;
    }
    const formData = new FormData();
    formData.append('image', selectedFile);
    try {
      await api.post('/images/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage('Image uploaded successfully!');
      setSelectedFile(null);
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      fetchImages();
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('Image upload failed.');
    }
  };

  const handleProcess = async (img: ImageMetadata, transformation: string) => {
    try {
      const sourceImage = activePreviews[img.unique_filename];
      const requestBody = {
        operations: [{ type: transformation }],
        source: sourceImage,
      };
      setMessage(`Applying ${transformation} effect...`);
      await api.post(`/images/${img.unique_filename}/process`, requestBody);
      setTimeout(() => {
        setMessage('');
        fetchImages();
      }, 3000);
    } catch (error) {
      console.error('Processing error:', error);
      setMessage('An error occurred during processing.');
    }
  };
  
  const handleDownload = async (filename: string) => {
    try {
      setMessage("Preparing final image for download...");
      const currentImage = images.find(img => 
        img.unique_filename === filename || img.processed_versions.includes(filename)
      );
      if (!currentImage) throw new Error("Could not find image metadata.");
      
      await api.post(`/images/${currentImage.unique_filename}/process`, {
        operations: [{ type: 'composite' }],
        source: filename,
      });
      
      setTimeout(async () => {
        const updatedImagesResponse = await api.get<PaginatedImagesResponse>('/images');
        const updatedImage = updatedImagesResponse.data.images.find(img => img.unique_filename === currentImage.unique_filename);
        
        if (updatedImage && updatedImage.processed_versions.length > 0) {
          const finalFile = updatedImage.processed_versions[updatedImage.processed_versions.length - 1];
          setMessage(`Downloading ${finalFile}...`);
          const fileResponse = await api.get(`/images/${finalFile}/file`, { responseType: 'blob' });
          const url = window.URL.createObjectURL(new Blob([fileResponse.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', 'processed-image.jpg');
          document.body.appendChild(link);
          link.click();
          link.parentNode?.removeChild(link);
          window.URL.revokeObjectURL(url);
          setMessage('');
          fetchImages();
        }
      }, 3000);

    } catch (error) {
      console.error('Download error:', error);
      setMessage('Download failed.');
    }
  };

  const setActivePreview = (imageId: string, filename: string) => {
    setActivePreviews(prev => ({ ...prev, [imageId]: filename }));
  };

  const handleEffectChange = (imageId: string, effect: string) => {
    setSelectedEffects(prev => ({ ...prev, [imageId]: effect }));
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>Welcome, {username}!</h1>
        <button onClick={onLogout}>Logout</button>
      </header>
      <section className="upload-section">
        <h3>Upload a New Image</h3>
        <input type="file" id="file-input" onChange={handleFileChange} />
        <button onClick={handleUpload}>Upload</button>
        {message && <p>{message}</p>}
      </section>
      <section>
        <h2>My Image Gallery</h2>
        <div className="image-gallery">
          {images.map((img) => (
            <div key={img.unique_filename} className="image-card">
              <button className="delete-btn" onClick={() => handleDelete(img.unique_filename)}>
                &times;
              </button>
              <h4>{img.original_filename}</h4>
              <div className="tag-container">
                {img.tags && JSON.parse(img.tags as any).map((tag: string) => (
                  <span key={tag} className="tag-badge">{tag}</span>
                ))}
              </div>
              <AuthenticatedImage
                src={`/images/${activePreviews[img.unique_filename]}/file`}
                alt="Active preview"
                className="main-preview-area"
              />
              
              {/* --- ADDED MISSING THUMBNAILS JSX --- */}
              <div className="previews-container">
                <div className="thumbnail-wrapper" onClick={() => setActivePreview(img.unique_filename, img.unique_filename)}>
                  <h5>Original</h5>
                  <AuthenticatedImage
                    src={`/images/${img.unique_filename}/file`}
                    alt="Original"
                    className={`thumbnail-img ${activePreviews[img.unique_filename] === img.unique_filename ? 'active' : ''}`}
                  />
                </div>
                {img.processed_versions.map((version, index) => (
                  <div className="thumbnail-wrapper" key={version} onClick={() => setActivePreview(img.unique_filename, version)}>
                    <h5>Effect {index + 1}</h5>
                    <AuthenticatedImage
                      src={`/images/${version}/file`}
                      alt={`Processed version ${index + 1}`}
                      className={`thumbnail-img ${activePreviews[img.unique_filename] === version ? 'active' : ''}`}
                    />
                  </div>
                ))}
              </div>
              
              <div className="image-actions-title">Apply Effect</div>
              <div className="image-actions">
                <select 
                  className="effect-dropdown" 
                  value={selectedEffects[img.unique_filename]}
                  onChange={(e) => handleEffectChange(img.unique_filename, e.target.value)}
                >
                  {availableEffects.map(effect => (
                    <option key={effect} value={effect}>
                      {effect.charAt(0).toUpperCase() + effect.slice(1)}
                    </option>
                  ))}
                </select>
                <button 
                  className="apply-btn" 
                  onClick={() => handleProcess(img, selectedEffects[img.unique_filename])}
                >
                  Apply
                </button>
              </div>
              <button className="download-btn" onClick={() => handleDownload(activePreviews[img.unique_filename])}>
                Download Final Image
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default DashboardPage;