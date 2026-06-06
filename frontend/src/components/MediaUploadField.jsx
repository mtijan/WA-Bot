import { useState, useRef } from 'react';
import { Upload, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { apiRequest } from '../apiClient';

const MediaUploadField = ({ mediaType = 'image', onUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isVideo = mediaType.toLowerCase() === 'video';
    const maxSize = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    const maxSizeMb = isVideo ? 10 : 5;

    // Client-side validation
    if (isVideo && !file.type.startsWith('video/')) {
      setError('Hanya file video yang diizinkan.');
      setSuccess(false);
      return;
    }
    if (!isVideo && !file.type.startsWith('image/')) {
      setError('Hanya file gambar yang diizinkan.');
      setSuccess(false);
      return;
    }

    if (file.size > maxSize) {
      setError(`Ukuran file melebihi batas. Maksimal ${maxSizeMb}MB.`);
      setSuccess(false);
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(false);

    try {
      const formData = new FormData();
      formData.append('media', file);

      const response = await apiRequest('/uploads/media', {
        method: 'POST',
        body: formData
      });

      if (response && response.status === 'success' && response.data) {
        setSuccess(true);
        setUploadedFile(file.name);
        if (onUploaded) {
          onUploaded(response.data);
        }
      } else {
        setError(response.message || 'Gagal mengupload file.');
      }
    } catch (err) {
      setError(err.message || 'Terjadi kesalahan saat mengupload file.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn btn-outline"
          style={{
            padding: '6px 12px',
            fontSize: '0.8rem',
            fontWeight: 500,
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'white',
            border: '1px solid var(--border-color)',
            height: '36px'
          }}
        >
          {uploading ? (
            <RefreshCw size={14} className="spin-animation" style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Upload size={14} />
          )}
          {uploading ? 'Uploading...' : `Upload ${mediaType}`}
        </button>
        
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept={mediaType.toLowerCase() === 'video' ? 'video/*' : 'image/*'}
          style={{ display: 'none' }}
        />

        {success && (
          <span style={{ 
            color: 'var(--success, #10b981)', 
            fontSize: '0.78rem', 
            fontWeight: 500, 
            display: 'flex', 
            alignItems: 'center', 
            gap: '4px',
            backgroundColor: 'var(--success-bg, #d1fae5)',
            padding: '2px 8px',
            borderRadius: '4px'
          }}>
            <Check size={14} /> Uploaded: {uploadedFile}
          </span>
        )}
      </div>

      {error && (
        <div style={{ 
          color: 'var(--danger, #ef4444)', 
          fontSize: '0.78rem', 
          fontWeight: 500, 
          display: 'flex', 
          alignItems: 'center', 
          gap: '4px',
          marginTop: '2px'
        }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
};

export default MediaUploadField;
