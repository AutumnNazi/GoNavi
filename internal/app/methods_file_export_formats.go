package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"

	"GoNavi-Wails/internal/dataexport"
)

func newParquetExportFileWriter(ctx context.Context, output io.Writer) *dataexport.Parquet {
	var factory dataexport.TempFactory
	if managed, ok := output.(*webTransferFile); ok {
		factory = func() (*dataexport.TempFile, error) {
			spool, err := os.CreateTemp(filepath.Dir(managed.file.Name()), "gonavi-export-parquet-*")
			if err != nil {
				return nil, err
			}
			quotaFile, err := newWebTransferFile(spool, managed.budget)
			if err != nil {
				return nil, errors.Join(err, spool.Close(), os.Remove(spool.Name()))
			}
			return &dataexport.TempFile{
				Reader: spool, Writer: quotaFile,
				Cleanup: func() error {
					closeErr := quotaFile.Close()
					removeErr := os.Remove(spool.Name())
					if removeErr == nil {
						managed.budget.release(quotaFile.size)
					}
					return errors.Join(closeErr, removeErr)
				},
			}, nil
		}
	}
	return dataexport.NewParquet(ctx, output, factory)
}

func abortExportFileWriter(writer exportFileWriter) error {
	if aborter, ok := writer.(interface{ Abort() error }); ok {
		return aborter.Abort()
	}
	return writer.Close()
}

func (a *App) validateExportEncoding(options ExportFileOptions) error {
	if options.Format != "csv" {
		return nil
	}
	if err := dataexport.ValidateCSVEncoding(options.CSVEncoding); err != nil {
		return errors.New(a.exportFormatErrorMessage(err, options))
	}
	return nil
}

func (a *App) exportFormatErrorMessage(err error, options ExportFileOptions) string {
	if errors.Is(err, dataexport.ErrInvalidCSVEncoding) {
		return a.appText("data_export.error.invalid_csv_encoding", map[string]any{"encoding": options.CSVEncoding})
	}
	if errors.Is(err, dataexport.ErrCSVEncoding) {
		return a.appText("data_export.error.csv_encoding_failed", map[string]any{"detail": err.Error()})
	}
	return a.appText("file.backend.error.write_failed", map[string]any{"detail": err.Error()})
}
