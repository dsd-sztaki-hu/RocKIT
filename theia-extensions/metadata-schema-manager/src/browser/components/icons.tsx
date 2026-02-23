// src/browser/components/icons.tsx
// This is a legacy code, please do not modify these, its important to keep these files as it is currently.

import * as React from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import LensIcon from "@mui/icons-material/Lens";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";


export function FolderOpen() {
  return <FolderOpenIcon fontSize="inherit" className="cedar-icon cedar-icon--folder" />;
}

export function FolderClosed() {
  return <FolderIcon fontSize="inherit" className="cedar-icon cedar-icon--folder" />;
}

export function File() {
  return <InsertDriveFileIcon className="cedar-icon" fontSize="inherit" />;
}

export function ShowLess() {
  return (
    <ExpandMoreIcon fontSize="inherit" className="cedar-icon">
      <path d="M22.047 22.074v0 0-20.147 0h-20.12v0 20.147 0h20.12zM22.047 24h-20.12q-.803 0-1.365-.562t-.562-1.365v-20.147q0-.776.562-1.351t1.365-.575h20.147q.776 0 1.351.575t.575 1.351v20.147q0 .803-.575 1.365t-1.378.562v0zM17.873 11.023h-11.826q-.375 0-.669.281t-.294.682v0q0 .401.294 .682t.669.281h11.826q.375 0 .669-.281t.294-.682v0q0-.401-.294-.682t-.669-.281z" />
    </ExpandMoreIcon>
  );
}

export function ShowMore() {
  return (
    <ChevronRightIcon fontSize="inherit" className="cedar-icon">
      <path d="M22.047 22.074v0 0-20.147 0h-20.12v0 20.147 0h20.12zM22.047 24h-20.12q-.803 0-1.365-.562t-.562-1.365v-20.147q0-.776.562-1.351t1.365-.575h20.147q.776 0 1.351.575t.575 1.351v20.147q0 .803-.575 1.365t-1.378.562v0zM17.873 12.977h-4.923v4.896q0 .401-.281.682t-.682.281v0q-.375 0-.669-.281t-.294-.682v-4.896h-4.923q-.401 0-.682-.294t-.281-.669v0q0-.401.281-.682t.682-.281h4.923v-4.896q0-.401.294-.682t.669-.281v0q.401 0 .682.281t.281.682v0q0 .375-.281.669t-.682.294z" />
    </ChevronRightIcon>
  );
}

export function ChildElement() {
  return <LensIcon className="cedar-icon cedar-icon--child" fontSize="inherit" />;
}