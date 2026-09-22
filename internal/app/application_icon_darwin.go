//go:build darwin && cgo

package app

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>
#import <stdlib.h>
#import <string.h>

static NSImage *gonaviCurrentDockIcon = nil;
static int gonaviDockIconLaunchObserverInstalled = 0;

static void gonaviApplyCurrentDockIcon(void) {
	if (gonaviCurrentDockIcon == nil || NSApp == nil) {
		return;
	}
	[NSApp setApplicationIconImage:gonaviCurrentDockIcon];
}

static void gonaviInstallDockIconLaunchObserver(void) {
	if (gonaviDockIconLaunchObserverInstalled) {
		return;
	}
	gonaviDockIconLaunchObserverInstalled = 1;
	[[NSNotificationCenter defaultCenter]
		addObserverForName:NSApplicationDidFinishLaunchingNotification
		object:nil
		queue:[NSOperationQueue mainQueue]
		usingBlock:^(NSNotification *note) {
			(void)note;
			gonaviApplyCurrentDockIcon();
		}];
}

static void gonaviRememberDockIcon(NSImage *image) {
	NSBitmapImageRep *bitmap = nil;
	for (NSImageRep *rep in [image representations]) {
		if ([rep isKindOfClass:[NSBitmapImageRep class]]) {
			bitmap = (NSBitmapImageRep *)rep;
			break;
		}
	}
	if (bitmap != nil && [bitmap pixelsWide] > 0 && [bitmap pixelsHigh] > 0) {
		[image setSize:NSMakeSize([bitmap pixelsWide], [bitmap pixelsHigh])];
	} else if (image.size.width <= 0.0 || image.size.height <= 0.0) {
		[image setSize:NSMakeSize(1024, 1024)];
	}
	[image setTemplate:NO];

	NSImage *previous = gonaviCurrentDockIcon;
	gonaviCurrentDockIcon = image;
	gonaviApplyCurrentDockIcon();
	if (previous != nil && previous != image) {
		[previous release];
	}
}

// macOS 15 can clear the Dock tile when the icon is set before launch finishes,
// or when the NSImage is built off the main thread. Keep the image alive and
// apply it again once launch has finished.
static int gonaviSetApplicationIconFromPNG(const void *data, int length) {
	if (data == NULL || length <= 0) {
		return 0;
	}
	void *copied = malloc((size_t)length);
	if (copied == NULL) {
		return 0;
	}
	memcpy(copied, data, (size_t)length);
	const int copiedLength = length;
	dispatch_async(dispatch_get_main_queue(), ^{
		NSData *pngData = [NSData dataWithBytesNoCopy:copied
		                                       length:(NSUInteger)copiedLength
		                                 freeWhenDone:YES];
		NSImage *image = [[NSImage alloc] initWithData:pngData];
		if (image == nil) {
			return;
		}
		gonaviRememberDockIcon(image);
		gonaviInstallDockIconLaunchObserver();
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
			gonaviApplyCurrentDockIcon();
		});
	});
	return 1;
}
*/
import "C"

import (
	"context"
	"errors"
	"unsafe"
)

func setApplicationIconPNG(png []byte, _ string, _ context.Context) error {
	if len(png) == 0 {
		return errors.New("application icon PNG is empty")
	}
	if C.gonaviSetApplicationIconFromPNG(unsafe.Pointer(&png[0]), C.int(len(png))) == 0 {
		return errors.New("failed to create macOS application icon image")
	}
	return nil
}
