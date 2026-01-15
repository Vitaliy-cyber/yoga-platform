import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, FileImage, CheckCircle, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";

interface DropzoneProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  onFileSelect,
  selectedFile,
  onClear,
  accept = { "image/*": [".jpeg", ".jpg", ".png", ".webp"] },
  maxSize = 10 * 1024 * 1024,
}) => {
  const [preview, setPreview] = useState<string | null>(null);

  React.useEffect(() => {
    if (selectedFile) {
      const objectUrl = URL.createObjectURL(selectedFile);
      setPreview(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setPreview(null);
    }
  }, [selectedFile]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } = useDropzone({
    onDrop,
    accept,
    maxSize,
    multiple: false,
    disabled: !!selectedFile,
  });

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {!selectedFile ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            key="dropzone"
          >
            <div
              {...getRootProps()}
              className={cn(
                "relative group cursor-pointer border-2 border-dashed rounded-2xl h-64 flex flex-col items-center justify-center transition-all duration-300 overflow-hidden",
                isDragActive
                  ? "border-primary bg-primary/5 shadow-[0_0_30px_-10px_var(--primary)]"
                  : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/30 bg-muted/10",
                isDragReject && "border-destructive bg-destructive/5"
              )}
            >
              <input {...getInputProps()} />

              <div className="relative z-10 flex flex-col items-center space-y-4 p-6 text-center">
                <div className={cn(
                  "p-4 rounded-full transition-transform duration-500 group-hover:scale-110",
                  isDragActive ? "bg-primary text-white shadow-lg" : "bg-secondary text-primary shadow-sm border border-white/10"
                )}>
                  <Upload size={32} className={cn(isDragActive ? "text-white" : "text-primary")} />
                </div>

                <div className="space-y-1">
                  <p className="font-semibold text-lg text-foreground">
                    {isDragActive ? "Drop file here" : "Click or drag file"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Supports SVG, PNG, JPG (max 10MB)
                  </p>
                </div>
              </div>

              {/* Background Pattern */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent" />
              </div>
            </div>

            {/* Error Message */}
            {fileRejections.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 text-sm text-destructive flex items-center gap-2"
              >
                <AlertTriangle size={16} />
                {fileRejections[0].errors[0].message}
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            key="preview"
            className="flex items-center gap-4 p-4 rounded-xl border bg-card/50 backdrop-blur-sm shadow-lg"
          >
            <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-muted/20 border border-white/10">
              {preview ? (
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <FileImage size={24} className="m-auto text-muted-foreground" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • Ready to upload
              </p>
              <div className="flex items-center gap-1 mt-1 text-emerald-500 text-xs font-medium">
                <CheckCircle size={12} /> Validated
              </div>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="p-2 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
