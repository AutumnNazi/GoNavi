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
static NSImage *gonaviAppliedDockIcon = nil;
static NSData *gonaviCurrentDockPNG = nil;
static int gonaviDockIconLaunchObserverInstalled = 0;
static int gonaviDockIconGeneration = 0;
static int gonaviSequoiaDockReplayPending = 0;

// macOS 15 is the only release that keeps a blank Dock tile after the first
// setApplicationIconImage:. macOS 26 already redraws that first image.
static int gonaviIsMacOS15(void) {
	return [[NSProcessInfo processInfo] operatingSystemVersion].majorVersion == 15;
}

static NSImage *gonaviNewDockImage(NSData *pngData) {
	if (pngData == nil) {
		return nil;
	}
	NSImage *image = [[NSImage alloc] initWithData:pngData];
	if (image == nil) {
		return nil;
	}
	NSBitmapImageRep *bitmap = nil;
	for (NSImageRep *rep in [image representations]) {
		if ([rep isKindOfClass:[NSBitmapImageRep class]]) {
			bitmap = (NSBitmapImageRep *)rep;
			break;
		}
	}
	if (bitmap != nil && [bitmap pixelsWide] > 0 && [bitmap pixelsHigh] > 0) {
		[image setSize:NSMakeSize([bitmap pixelsWide], [bitmap pixelsHigh])];
		// Decode now. Sequoia snapshots the Dock tile before a lazy PNG is ready.
		(void)[bitmap bitmapData];
	} else if (image.size.width <= 0.0 || image.size.height <= 0.0) {
		[image setSize:NSMakeSize(1024, 1024)];
	}
	[image setTemplate:NO];
	return image;
}

static void gonaviApplyCurrentDockIcon(void) {
	if (NSApp == nil) {
		return;
	}
	// Sequoia ignores a second set of the same NSImage after it cached a blank
	// tile. Rebuild from the PNG so every apply is a distinct image.
	if (gonaviIsMacOS15()) {
		NSImage *fresh = gonaviNewDockImage(gonaviCurrentDockPNG);
		if (fresh == nil) {
			return;
		}
		[NSApp setApplicationIconImage:fresh];
		NSDockTile *tile = [NSApp dockTile];
		if (tile != nil) {
			[tile display];
		}
		NSImage *previousApplied = gonaviAppliedDockIcon;
		gonaviAppliedDockIcon = fresh;
		if (previousApplied != nil && previousApplied != fresh) {
			[previousApplied release];
		}
		return;
	}
	if (gonaviCurrentDockIcon == nil) {
		return;
	}
	[NSApp setApplicationIconImage:gonaviCurrentDockIcon];
}

static void gonaviInstallDockIconLaunchObserver(void) {
	if (gonaviDockIconLaunchObserverInstalled) {
		return;
	}
	gonaviDockIconLaunchObserverInstalled = 1;
	NSOperationQueue *mainQueue = [NSOperationQueue mainQueue];
	NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
	[center addObserverForName:NSApplicationDidFinishLaunchingNotification
	                    object:nil
	                     queue:mainQueue
	                usingBlock:^(NSNotification *note) {
		(void)note;
		gonaviApplyCurrentDockIcon();
	}];
	[center addObserverForName:NSApplicationDidBecomeActiveNotification
	                    object:nil
	                     queue:mainQueue
	                usingBlock:^(NSNotification *note) {
		(void)note;
		if (gonaviSequoiaDockReplayPending) {
			gonaviApplyCurrentDockIcon();
		}
	}];
}

static void gonaviScheduleDockIconReapply(int generation) {
	if (!gonaviIsMacOS15()) {
		dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
			gonaviApplyCurrentDockIcon();
		});
		return;
	}
	gonaviSequoiaDockReplayPending = 1;
	dispatch_async(dispatch_get_main_queue(), ^{
		if (generation != gonaviDockIconGeneration) {
			return;
		}
		gonaviApplyCurrentDockIcon();
	});
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		if (generation != gonaviDockIconGeneration) {
			return;
		}
		gonaviApplyCurrentDockIcon();
	});
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		if (generation != gonaviDockIconGeneration) {
			return;
		}
		gonaviApplyCurrentDockIcon();
		gonaviSequoiaDockReplayPending = 0;
	});
}

static void gonaviRememberDockIcon(NSImage *image, NSData *pngData) {
	NSData *keptPNG = [pngData copy];
	NSData *previousPNG = gonaviCurrentDockPNG;
	gonaviCurrentDockPNG = keptPNG;
	if (previousPNG != nil) {
		[previousPNG release];
	}

	NSImage *previous = gonaviCurrentDockIcon;
	gonaviCurrentDockIcon = image;
	gonaviDockIconGeneration++;
	gonaviApplyCurrentDockIcon();
	if (previous != nil && previous != image) {
		[previous release];
	}
	gonaviInstallDockIconLaunchObserver();
	gonaviScheduleDockIconReapply(gonaviDockIconGeneration);
}

// macOS 15 can clear the Dock tile when the icon is set before launch finishes,
// and it will not redraw that same NSImage later. Keep the PNG, hand Dock a
// new image on each apply, and repeat until the tile has settled.
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
		NSImage *image = gonaviNewDockImage(pngData);
		if (image == nil) {
			return;
		}
		gonaviRememberDockIcon(image, pngData);
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
