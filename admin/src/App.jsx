import {
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Files,
  Github,
  HardDrive,
  Layers3,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  renderSlugTemplate,
  slugTemplateFieldNames,
  uniqueFilenameStem
} from "../shared/slug.js";
import {
  DEFAULT_LAYOUT_PREFERENCES,
  LAYOUT_STORAGE_KEY,
  MAX_INSPECTOR_WIDTH,
  MAX_TREE_WIDTH,
  MIN_COLLECTION_TREE_HEIGHT,
  MIN_CONTENT_TREE_HEIGHT,
  MIN_INSPECTOR_WIDTH,
  MIN_PREVIEW_WIDTH,
  MIN_TABLE_WIDTH,
  MIN_TREE_WIDTH,
  RESIZE_HANDLE_SIZE,
  clampNumber,
  cloneContentNode,
  collectNodeIds,
  collectionCopyContext,
  collectionEntries,
  collectionHierarchyValue,
  collectionInsertionModes,
  collectionNameFromHash,
  contentInsertionModes,
  contentPasteTarget,
  cx,
  defaultProperties,
  descendantIds,
  findLocation,
  fitLayoutPreferences,
  getNode,
  getNodePath,
  iconFor,
  newNode,
  nextTreeSelection,
  readLayoutPreferences,
  refreshUuidFields,
  replaceCollectionHash,
  selectedTopLevelContentNodes,
  typeField,
  uniqueRecordId,
  updateNode
} from "./model/editor.js";
import { panelsFor } from "./model/views.js";
import { CollectionTable } from "./components/CollectionTable/CollectionTable.jsx";
import { useAdapterContext } from "./adapters/AdapterContext.jsx";
import ConfigurationEditor from "./components/ConfigurationEditor/ConfigurationEditor.jsx";
import {
  BrandMark,
  EmptyState,
  MultiSelectionNotice,
  ResizeHandle,
  Spinner
} from "./components/Common/Common.jsx";
import { ConfirmationDialog, InsertionDialog } from "./components/Dialogs/Dialogs.jsx";
import { Inspector } from "./components/Inspector/Inspector.jsx";
import { Preview } from "./components/Preview/Preview.jsx";
import { CollectionTree, ContentTree } from "./components/Trees/Trees.jsx";
import "./App.scss";

export default function App() {
  const {
    adapter: api,
    session: adapterSession,
    login: loginAdapter,
    logout: logoutAdapter
  } = useAdapterContext();
  const [config, setConfig] = useState(null);
  const [activeCollection, setActiveCollection] = useState("");
  const [items, setItems] = useState([]);
  const [record, setRecord] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState(new Set());
  const [recordSelectionAnchor, setRecordSelectionAnchor] = useState("");
  const [selectedContentIds, setSelectedContentIds] = useState(new Set());
  const [contentSelectionAnchor, setContentSelectionAnchor] = useState("");
  const [pageExpanded, setPageExpanded] = useState(new Set());
  const [contentExpanded, setContentExpanded] = useState(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [insertDialog, setInsertDialog] = useState(null);
  const [activePanel, setActivePanel] = useState("inspector");
  const [clipboard, setClipboard] = useState(null);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [activeTreeSelection, setActiveTreeSelection] = useState("collection");
  const [confirmation, setConfirmation] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [layoutPreferences, setLayoutPreferences] = useState(
    readLayoutPreferences
  );
  const activeCollectionRef = useRef("");
  const breadcrumbRef = useRef(null);
  const workspaceRef = useRef(null);
  const leftRailRef = useRef(null);

  const collections = useMemo(() => collectionEntries(config), [config]);
  const collection = collections.find((entry) => entry.name === activeCollection);
  const isTableView = collection?.views?.list?.type === "table";
  const nodeTypes = config?.node_types ?? {};
  const documentType = collection ? nodeTypes[collection.node_type] : null;
  const documentHasHidden = Boolean(typeField(documentType, "hidden"));
  const treeItems = useMemo(
    () =>
      items.map((item) =>
        item.id === record?.id
          ? {
              ...item,
              title: record.properties?.title || record.id,
              hidden: Boolean(record.properties?.hidden),
              properties: record.properties ?? {}
            }
          : item
      ),
    [items, record]
  );
  const selectedNode = getNode(record, selectedId);
  const selectedNodePath = getNodePath(record, selectedId);
  const selectedNodeType = selectedNode ? nodeTypes[selectedNode.type] : null;
  const selectedIsDocument = Boolean(
    selectedNode && record && selectedNode.id === record.id
  );
  const inspectorPanels = panelsFor(selectedNodeType, selectedIsDocument);
  const effectivePanel =
    inspectorPanels.find((panel) => panel.name === activePanel)?.name ||
    inspectorPanels[0].name;
  const selectedNodeHasHidden = Boolean(typeField(selectedNodeType, "hidden"));
  const collectionInsertModes = collection
    ? collectionInsertionModes(collection, items, record)
    : [];
  const contentInsertModes = contentInsertionModes(record, selectedId, nodeTypes);
  const copyableContentNodes = useMemo(
    () => selectedTopLevelContentNodes(record, selectedContentIds),
    [record, selectedContentIds]
  );
  const contentPasteDestination =
    clipboard?.kind === "content"
      ? contentPasteTarget(record, selectedId, clipboard.nodes, nodeTypes)
      : null;
  const collectionPasteContext = useMemo(() => {
    if (
      clipboard?.kind !== "collection" ||
      clipboard.collectionName !== activeCollection ||
      !collection
    ) {
      return null;
    }
    return collectionCopyContext(
      clipboard.records,
      collection,
      items,
      record?.id
    );
  }, [activeCollection, clipboard, collection, items, record?.id]);
  const multipleTreeSelection =
    !isTableView &&
    (activeTreeSelection === "collection" && selectedRecordIds.size > 1
      ? {
          count: selectedRecordIds.size,
          label: collection?.label?.toLowerCase() || "records",
          icon: Files
        }
      : activeTreeSelection === "content" && selectedContentIds.size > 1
        ? {
            count: selectedContentIds.size,
            label: "content items",
            icon: Layers3
          }
        : null);
  const workspaceStyle = {
    "--left-pane-width": `${layoutPreferences.treeLeftWidth}px`,
    "--right-pane-width": `${
      isTableView
        ? layoutPreferences.tableRightWidth
        : layoutPreferences.treeRightWidth
    }px`,
    "--tree-split": `${layoutPreferences.treeSplit * 100}%`
  };

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  async function toggleAdapterSession() {
    if (api.name !== "github" || authenticating) return;
    if (adapterSession.authenticated) {
      logoutAdapter();
      showToast("Signed out from GitHub");
      return;
    }
    setAuthenticating(true);
    setError("");
    try {
      const nextSession = await loginAdapter();
      showToast(`Signed in as ${nextSession.login || "GitHub"}`);
      if (activeCollection) await loadCollection(activeCollection);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setAuthenticating(false);
    }
  }

  const loadRecord = useCallback(async (collectionName, id) => {
    setLoading(true);
    setError("");
    try {
      const nextRecord = await api.record(collectionName, id);
      if (activeCollectionRef.current !== collectionName) return;
      setRecord(nextRecord);
      setSelectedId(nextRecord.id);
      setSelectedContentIds(new Set([nextRecord.id]));
      setContentSelectionAnchor(nextRecord.id);
      const expanded = new Set([nextRecord.id]);
      const expandContainers = (node) => {
        for (const children of Object.values(node.slots ?? {})) {
          if (children.length) expanded.add(node.id);
          children.forEach(expandContainers);
        }
      };
      expandContainers(nextRecord);
      setContentExpanded(expanded);
      setDirty(false);
    } catch (loadError) {
      setError(loadError.message);
      setRecord(null);
      setSelectedId("");
      setSelectedContentIds(new Set());
      setContentSelectionAnchor("");
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadCollection = useCallback(
    async (collectionName, preferredId = null) => {
      activeCollectionRef.current = collectionName;
      setActiveCollection(collectionName);
      setActiveTreeSelection("collection");
      setRecord(null);
      setSelectedId("");
      setSelectedRecordIds(new Set());
      setRecordSelectionAnchor("");
      setSelectedContentIds(new Set());
      setContentSelectionAnchor("");
      setLoading(true);
      setError("");
      try {
        const result = await api.list(collectionName);
        if (activeCollectionRef.current !== collectionName) return;
        setItems(result.items);
        const parentReferences = new Set(
          result.items.map((item) => item.parent).filter(Boolean)
        );
        setPageExpanded(
          new Set(
            result.items
              .filter((item) =>
                parentReferences.has(item.hierarchy_id || item.id)
              )
              .map((item) => item.id)
          )
        );
        const nextId = preferredId
          ? result.items.find((item) => item.id === preferredId)?.id
          : null;
        if (nextId) {
          setSelectedRecordIds(new Set([nextId]));
          setRecordSelectionAnchor(nextId);
          await loadRecord(collectionName, nextId);
        } else {
          setLoading(false);
        }
      } catch (loadError) {
        setError(loadError.message);
        setLoading(false);
      }
    },
    [api, loadRecord]
  );

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((nextConfig) => {
        if (cancelled) return;
        setConfig(nextConfig);
        const configuredCollections = collectionEntries(nextConfig);
        const initialCollection =
          collectionNameFromHash(nextConfig) ||
          configuredCollections[0]?.name;
        if (initialCollection) {
          replaceCollectionHash(initialCollection);
          loadCollection(initialCollection);
        } else {
          setLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, loadCollection]);

  useEffect(() => {
    if (!breadcrumbRef.current) return;
    breadcrumbRef.current.scrollLeft = breadcrumbRef.current.scrollWidth;
  }, [selectedId, record?.id]);

  useEffect(() => {
    if (!config || !activeCollection) return undefined;
    function syncCollectionFromHash() {
      const requestedCollection = collectionNameFromHash(config);
      if (!requestedCollection) {
        replaceCollectionHash(activeCollection);
        return;
      }
      if (requestedCollection === activeCollection) return;
      if (dirty) replaceCollectionHash(activeCollection);
      runAfterDiscardCheck(() => {
        replaceCollectionHash(requestedCollection);
        setSearch("");
        return loadCollection(requestedCollection);
      });
    }
    window.addEventListener("hashchange", syncCollectionFromHash);
    return () =>
      window.removeEventListener("hashchange", syncCollectionFromHash);
  }, [activeCollection, config, dirty, loadCollection]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAYOUT_STORAGE_KEY,
        JSON.stringify(layoutPreferences)
      );
    } catch {
      // Local storage can be unavailable in privacy-restricted browsers.
    }
  }, [layoutPreferences]);

  useEffect(() => {
    function fitToViewport() {
      setLayoutPreferences((current) => {
        const viewportWidth =
          workspaceRef.current?.getBoundingClientRect().width ??
          window.innerWidth;
        const fitted = fitLayoutPreferences(current, viewportWidth);
        return Object.keys(fitted).every(
          (name) => fitted[name] === current[name]
        )
          ? current
          : fitted;
      });
    }
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, []);

  function resizeTreeLeft(delta) {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ??
      window.innerWidth;
    setLayoutPreferences((current) => ({
      ...current,
      treeLeftWidth: Math.round(
        clampNumber(
          current.treeLeftWidth + delta,
          MIN_TREE_WIDTH,
          Math.min(
            MAX_TREE_WIDTH,
            workspaceWidth -
              current.treeRightWidth -
              MIN_PREVIEW_WIDTH -
              RESIZE_HANDLE_SIZE * 2
          )
        )
      )
    }));
  }

  function resizeInspector(delta) {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ??
      window.innerWidth;
    setLayoutPreferences((current) => {
      const name = isTableView
        ? "tableRightWidth"
        : "treeRightWidth";
      const minimumMainWidth = isTableView
        ? MIN_TABLE_WIDTH
        : MIN_PREVIEW_WIDTH + current.treeLeftWidth + RESIZE_HANDLE_SIZE;
      const maximum = Math.min(
        MAX_INSPECTOR_WIDTH,
        workspaceWidth - minimumMainWidth - RESIZE_HANDLE_SIZE
      );
      return {
        ...current,
        [name]: Math.round(
          clampNumber(
            current[name] - delta,
            MIN_INSPECTOR_WIDTH,
            maximum
          )
        )
      };
    });
  }

  function resizeTreeSplit(delta) {
    const railHeight =
      leftRailRef.current?.getBoundingClientRect().height ?? 0;
    const availableHeight = railHeight - RESIZE_HANDLE_SIZE;
    if (availableHeight <= 0) return;
    const minimumRatio = Math.min(
      0.5,
      MIN_COLLECTION_TREE_HEIGHT / availableHeight
    );
    const maximumRatio = Math.max(
      0.5,
      1 - MIN_CONTENT_TREE_HEIGHT / availableHeight
    );
    setLayoutPreferences((current) => ({
      ...current,
      treeSplit: clampNumber(
        current.treeSplit + delta / availableHeight,
        minimumRatio,
        maximumRatio
      )
    }));
  }

  function runAfterDiscardCheck(action) {
    if (!dirty) {
      action();
      return;
    }
    setConfirmation({
      title: "Discard unsaved changes?",
      description:
        "The current record has changes that have not been saved. This action cannot be undone.",
      confirmLabel: "Discard changes",
      danger: true,
      onConfirm: async () => {
        setDirty(false);
        await action();
      }
    });
  }

  function switchCollection(name) {
    if (name === activeCollection) return;
    runAfterDiscardCheck(() => {
      replaceCollectionHash(name);
      setSearch("");
      return loadCollection(name);
    });
  }

  function selectRecord(id) {
    if (id === record?.id) return;
    runAfterDiscardCheck(() => {
      setActiveTreeSelection("collection");
      setSelectedRecordIds(new Set([id]));
      setRecordSelectionAnchor(id);
      return loadRecord(activeCollection, id);
    });
  }

  function changeCollectionSelection({ selectedIds, anchorId, activeId }) {
    const applySelection = () => {
      setActiveTreeSelection("collection");
      setSelectedRecordIds(selectedIds);
      setRecordSelectionAnchor(anchorId);
      if (activeId !== record?.id) {
        return loadRecord(activeCollection, activeId);
      }
    };
    if (activeId === record?.id) applySelection();
    else runAfterDiscardCheck(applySelection);
  }

  function clearCollectionSelection() {
    if (!selectedRecordIds.size && !record) return;
    runAfterDiscardCheck(() => {
      setActiveTreeSelection("collection");
      setSelectedRecordIds(new Set());
      setRecordSelectionAnchor("");
      setSelectedContentIds(new Set());
      setContentSelectionAnchor("");
      setSelectedId("");
      setRecord(null);
    });
  }

  function changeContentSelection({ selectedIds, anchorId, activeId }) {
    setActiveTreeSelection("content");
    setSelectedContentIds(selectedIds);
    setContentSelectionAnchor(anchorId);
    setSelectedId(activeId);
  }

  function clearContentSelection() {
    if (!selectedContentIds.size && !selectedId) return;
    setActiveTreeSelection("content");
    setSelectedContentIds(new Set());
    setContentSelectionAnchor("");
    setSelectedId("");
  }

  function changeRecord(update) {
    setRecord((current) => update(current));
    setDirty(true);
  }

  function changeProperty(nodeId, name, value) {
    changeRecord((current) =>
      updateNode(current, nodeId, (node) => ({
        ...node,
        properties: { ...(node.properties ?? {}), [name]: value }
      }))
    );
  }

  async function saveRecord() {
    if (!record || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.save(activeCollection, record);
      setItems((current) =>
        current.map((item) => (item.id === result.item.id ? result.item : item))
      );
      setDirty(false);
      showToast(`${record.properties?.title || record.id} saved`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveConfiguration(nextConfig) {
    const result = await api.saveConfig(nextConfig);
    setConfig(result.config);
    const nextCollection =
      result.config.collections?.[activeCollection]
        ? activeCollection
        : Object.keys(result.config.collections ?? {})[0];
    if (nextCollection) {
      replaceCollectionHash(nextCollection);
      await loadCollection(nextCollection);
    }
    showToast("CMS settings saved");
    return result.config;
  }

  async function editTableField(item, column, value) {
    if (saving || column.field.startsWith("$")) return;
    if (dirty && record?.id === item.id) {
      setError("Save the current inspector changes before editing this table row.");
      return;
    }
    const fieldName = column.field.replace(/^properties\./, "");
    setSaving(true);
    setError("");
    try {
      const sourceRecord =
        record?.id === item.id
          ? record
          : await api.record(activeCollection, item.id);
      const nextRecord = {
        ...sourceRecord,
        properties: {
          ...(sourceRecord.properties ?? {}),
          [fieldName]: value
        }
      };
      const result = await api.save(activeCollection, nextRecord);
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === result.item.id ? result.item : currentItem
        )
      );
      if (record?.id === item.id) setRecord(nextRecord);
      showToast(`${column.label || fieldName} updated`);
    } catch (editError) {
      setError(editError.message);
    } finally {
      setSaving(false);
    }
  }

  async function regenerateRecordFilename() {
    if (!record || !collection?.slug || saving) return;
    if (dirty) {
      setError("Save the current changes before regenerating its YAML filename.");
      return;
    }
    const existingIds = items
      .map((item) => item.id)
      .filter((id) => id !== record.id);
    const nextId = uniqueFilenameStem(
      renderSlugTemplate(collection.slug, {
        fields: record.properties,
        identifierField: collection.identifier_field || "title",
        date: new Date()
      }),
      new Set(existingIds)
    );
    const oldId = record.id;
    if (nextId.toLowerCase() === oldId.toLowerCase()) {
      showToast("Filename already matches the configured slug");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.rename(activeCollection, oldId, nextId);
      setDirty(false);
      await loadCollection(activeCollection, nextId);
      showToast(`${oldId} renamed to ${nextId}`);
    } catch (renameError) {
      setError(renameError.message);
    } finally {
      setSaving(false);
    }
  }

  async function insertCollectionItem({ choice, title, id, properties: initialProperties }) {
    setActiveTreeSelection("collection");
    const type = nodeTypes[choice.typeName];
    const properties = structuredClone(
      initialProperties ?? defaultProperties(type)
    );
    properties.title = title;
    if ("slug" in properties && !properties.slug) {
      properties.slug = id;
    }
    const parentField = collection.hierarchy?.parent_field;
    if (parentField) properties[parentField] = choice.parent ?? null;
    const slots = Object.fromEntries(
      Object.keys(type.slots ?? {}).map((slotName) => [slotName, []])
    );
    const newRecord = {
      id,
      type: choice.typeName,
      order: choice.order,
      properties,
      slots
    };

    const result = await api.create(activeCollection, newRecord);
    setInsertDialog(null);
    if (dirty) {
      setItems((current) => [...current, result.item]);
    } else {
      await loadCollection(activeCollection, newRecord.id);
    }
    showToast(`${newRecord.properties.title} created`);
  }

  async function copySelectedRecords() {
    if (!selectedRecordIds.size || clipboardBusy) return;
    setClipboardBusy(true);
    setError("");
    try {
      const selectedItems = items
        .filter((item) => selectedRecordIds.has(item.id))
        .sort(
          (left, right) =>
            left.order - right.order || left.title.localeCompare(right.title)
        );
      const records = await Promise.all(
        selectedItems.map((item) =>
          item.id === record?.id
            ? structuredClone(record)
            : api.record(activeCollection, item.id)
        )
      );
      setClipboard({
        kind: "collection",
        collectionName: activeCollection,
        records
      });
      showToast(
        `${records.length} ${records.length === 1 ? "record" : "records"} copied`
      );
    } catch (copyError) {
      setError(copyError.message);
    } finally {
      setClipboardBusy(false);
    }
  }

  async function createRecordCopies(
    sourceRecords,
    copyContext,
    {
      idSuffix = "copy",
      titleSuffix = "",
      action = "pasted",
      focusCreated = true,
      preserveRootPlacement = false
    } = {}
  ) {
    const createdItems = [];
    try {
      const usedIds = new Set(items.map((item) => item.id));
      const copyDate = new Date();
      const prepared = sourceRecords.map((sourceRecord) => {
        const oldHierarchyId = collectionHierarchyValue(
          sourceRecord,
          collection,
          "id_field",
          sourceRecord.id
        );
        const oldParent = collectionHierarchyValue(
          sourceRecord,
          collection,
          "parent_field",
          sourceRecord.parent ?? null
        );
        const duplicate = structuredClone(sourceRecord);
        refreshUuidFields(duplicate, nodeTypes);
        if (titleSuffix && duplicate.properties?.title) {
          duplicate.properties.title = `${duplicate.properties.title} ${titleSuffix}`;
        }
        duplicate.id = collection.slug
          ? uniqueFilenameStem(
              renderSlugTemplate(collection.slug, {
                fields: duplicate.properties,
                identifierField: collection.identifier_field || "title",
                date: copyDate
              }),
              usedIds
            )
          : uniqueRecordId(sourceRecord.id, usedIds, idSuffix);
        if ("slug" in (duplicate.properties ?? {})) {
          duplicate.properties.slug = String(
            sourceRecord.properties?.slug || ""
          ).startsWith("/")
            ? `/${duplicate.id}`
            : duplicate.id;
        }
        return {
          duplicate,
          oldHierarchyId,
          oldParent,
          newHierarchyId: collectionHierarchyValue(
            duplicate,
            collection,
            "id_field",
            duplicate.id
          )
        };
      });
      const hierarchyIdMap = new Map(
        prepared.map((entry) => [entry.oldHierarchyId, entry.newHierarchyId])
      );
      const rootHierarchyIds = new Set(
        copyContext.rootRecords.map((rootRecord) =>
          collectionHierarchyValue(
            rootRecord,
            collection,
            "id_field",
            rootRecord.id
          )
        )
      );
      const rootEntries = prepared.filter((entry) =>
        rootHierarchyIds.has(entry.oldHierarchyId)
      );
      const sourceItemByHierarchyId = new Map(
        items.map((item) => [item.hierarchy_id || item.id, item])
      );
      const destinationSiblings = preserveRootPlacement
        ? []
        : items
            .filter(
              (item) =>
                (item.parent ?? null) === (copyContext.parent ?? null)
            )
            .sort(
              (left, right) =>
                left.order - right.order ||
                left.title.localeCompare(right.title)
            );
      const focusedIndex = copyContext.focusedItem
        ? destinationSiblings.findIndex(
            (item) => item.id === copyContext.focusedItem.id
          )
        : -1;
      const previousOrder =
        focusedIndex === -1
          ? destinationSiblings.at(-1)?.order ?? -1
          : destinationSiblings[focusedIndex]?.order ?? 0;
      const nextOrder =
        focusedIndex !== -1
          ? destinationSiblings[focusedIndex + 1]?.order
          : undefined;

      prepared.forEach((entry) => {
        const parent =
          hierarchyIdMap.get(entry.oldParent) ??
          (preserveRootPlacement ? entry.oldParent : copyContext.parent) ??
          null;
        const parentField = collection.hierarchy?.parent_field;
        if (parentField) {
          entry.duplicate.properties = {
            ...(entry.duplicate.properties ?? {}),
            [parentField]: parent
          };
        } else {
          entry.duplicate.parent = parent;
        }

        const rootIndex = rootEntries.indexOf(entry);
        if (rootIndex !== -1) {
          if (preserveRootPlacement) {
            const sourceItem = sourceItemByHierarchyId.get(entry.oldHierarchyId);
            const sourceSiblings = items
              .filter(
                (item) =>
                  (item.parent ?? null) ===
                  (sourceItem?.parent ?? entry.oldParent ?? null)
              )
              .sort(
                (left, right) =>
                  left.order - right.order ||
                  left.title.localeCompare(right.title)
              );
            const sourceIndex = sourceSiblings.findIndex(
              (item) => item.id === sourceItem?.id
            );
            const sourceOrder =
              sourceItem?.order ?? entry.duplicate.order ?? 0;
            const followingOrder =
              sourceIndex === -1
                ? undefined
                : sourceSiblings[sourceIndex + 1]?.order;
            entry.duplicate.order =
              followingOrder === undefined
                ? sourceOrder + 1
                : sourceOrder + (followingOrder - sourceOrder) / 2;
          } else {
            entry.duplicate.order =
              nextOrder === undefined
                ? previousOrder + rootIndex + 1
                : previousOrder +
                  ((nextOrder - previousOrder) * (rootIndex + 1)) /
                    (rootEntries.length + 1);
          }
        }
      });

      const preparedByHierarchyId = new Map(
        prepared.map((entry) => [entry.oldHierarchyId, entry])
      );
      const copiedDepth = (entry) => {
        let depth = 0;
        let parent = preparedByHierarchyId.get(entry.oldParent);
        const visited = new Set();
        while (parent && !visited.has(parent.oldHierarchyId)) {
          visited.add(parent.oldHierarchyId);
          depth += 1;
          parent = preparedByHierarchyId.get(parent.oldParent);
        }
        return depth;
      };
      const creationOrder = [...prepared].sort(
        (left, right) => copiedDepth(left) - copiedDepth(right)
      );
      for (const entry of creationOrder) {
        const result = await api.create(activeCollection, entry.duplicate);
        createdItems.push(result.item);
      }
      const createdIds = createdItems.map((item) => item.id);
      setItems((current) => [...current, ...createdItems]);
      if (focusCreated) {
        setSelectedRecordIds(new Set(createdIds));
        setRecordSelectionAnchor(createdIds[0]);
        setActiveTreeSelection("collection");
      }
      setPageExpanded(
        (current) =>
          new Set([
            ...current,
            ...prepared
              .filter((entry) =>
                prepared.some(
                  (candidate) =>
                    candidate.oldParent === entry.oldHierarchyId
                )
              )
              .map((entry) => entry.duplicate.id)
          ])
      );
      if (focusCreated) {
        await loadRecord(activeCollection, createdIds[0]);
      }
      showToast(
        `${createdIds.length} ${createdIds.length === 1 ? "record" : "records"} ${action}`
      );
      return createdIds;
    } catch (copyError) {
      if (createdItems.length) {
        await loadCollection(activeCollection, createdItems[0].id);
      }
      throw copyError;
    }
  }

  async function pasteCopiedRecords() {
    if (!collectionPasteContext || clipboardBusy || dirty || saving) return;
    setClipboardBusy(true);
    setError("");
    try {
      await createRecordCopies(
        clipboard.records,
        collectionPasteContext
      );
    } catch (pasteError) {
      setError(pasteError.message);
    } finally {
      setClipboardBusy(false);
    }
  }

  function copySelectedContent() {
    if (!copyableContentNodes.length) return;
    const nodes = copyableContentNodes.map((node) => structuredClone(node));
    setClipboard({ kind: "content", nodes });
    showToast(
      `${nodes.length} content ${nodes.length === 1 ? "item" : "items"} copied`
    );
  }

  function pasteCopiedContent() {
    if (!contentPasteDestination || clipboard?.kind !== "content") return;
    setActiveTreeSelection("content");
    const usedIds = collectNodeIds(record);
    const nodes = clipboard.nodes.map((node) => {
      const clone = cloneContentNode(node, usedIds);
      refreshUuidFields(clone, nodeTypes);
      return clone;
    });
    changeRecord((current) =>
      updateNode(current, contentPasteDestination.parentId, (parent) => {
        const children = [
          ...(parent.slots?.[contentPasteDestination.slotName] ?? [])
        ];
        children.splice(contentPasteDestination.index, 0, ...nodes);
        return {
          ...parent,
          slots: {
            ...(parent.slots ?? {}),
            [contentPasteDestination.slotName]: children
          }
        };
      })
    );
    const pastedIds = nodes.map((node) => node.id);
    setContentExpanded(
      (current) =>
        new Set([...current, contentPasteDestination.parentId])
    );
    setSelectedContentIds(new Set(pastedIds));
    setContentSelectionAnchor(pastedIds[0]);
    setSelectedId(pastedIds.at(-1));
    showToast(
      `${nodes.length} content ${nodes.length === 1 ? "item" : "items"} pasted`
    );
  }

  function toggleDocumentVisibility() {
    if (!record || !documentHasHidden) return;
    changeProperty(record.id, "hidden", !record.properties?.hidden);
  }

  function toggleSelectedVisibility() {
    if (!selectedNode || !selectedNodeHasHidden) return;
    changeProperty(selectedNode.id, "hidden", !selectedNode.properties?.hidden);
  }

  async function duplicateRecords(recordIds) {
    if (!recordIds.size || saving) return;
    setSaving(true);
    setError("");
    try {
      const selectedItems = items
        .filter((item) => recordIds.has(item.id))
        .sort(
          (left, right) =>
            left.order - right.order || left.title.localeCompare(right.title)
        );
      const records = await Promise.all(
        selectedItems.map((item) =>
          item.id === record?.id
            ? structuredClone(record)
          : api.record(activeCollection, item.id)
        )
      );
      const selectedHierarchyIds = new Set(
        records.map((selectedRecord) =>
          collectionHierarchyValue(
            selectedRecord,
            collection,
            "id_field",
            selectedRecord.id
          )
        )
      );
      const rootRecords = records.filter((selectedRecord) => {
        const parent = collectionHierarchyValue(
          selectedRecord,
          collection,
          "parent_field",
          selectedRecord.parent ?? null
        );
        return !selectedHierarchyIds.has(parent);
      });
      await createRecordCopies(
        records,
        { rootRecords, parent: null, focusedItem: null },
        {
          idSuffix: "duplicate",
          titleSuffix: "duplicate",
          action: "duplicated",
          focusCreated: !dirty,
          preserveRootPlacement: true
        }
      );
    } catch (duplicateError) {
      setError(duplicateError.message);
    } finally {
      setSaving(false);
    }
  }

  function duplicateSelectedRecords() {
    return duplicateRecords(selectedRecordIds);
  }

  function duplicateCurrentRecord() {
    if (!record) return;
    return duplicateRecords(new Set([record.id]));
  }

  async function deleteRecords(recordIds) {
    const selectedItems = items.filter((item) => recordIds.has(item.id));
    if (!selectedItems.length || saving) return;
    const itemByHierarchyId = new Map(
      items.map((item) => [item.hierarchy_id || item.id, item])
    );
    const depthOf = (item) => {
      let depth = 0;
      let parent = item.parent
        ? itemByHierarchyId.get(item.parent)
        : null;
      const visited = new Set();
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        depth += 1;
        parent = parent.parent
          ? itemByHierarchyId.get(parent.parent)
          : null;
      }
      return depth;
    };
    const deletionOrder = [...selectedItems].sort(
      (left, right) => depthOf(right) - depthOf(left)
    );
    const currentWillBeDeleted = Boolean(record && recordIds.has(record.id));
    const currentItem = currentWillBeDeleted
      ? items.find((item) => item.id === record.id)
      : null;
    let fallbackParent = currentItem?.parent
      ? itemByHierarchyId.get(currentItem.parent)
      : null;
    while (fallbackParent && recordIds.has(fallbackParent.id)) {
      fallbackParent = fallbackParent.parent
        ? itemByHierarchyId.get(fallbackParent.parent)
        : null;
    }
    const nextId = currentWillBeDeleted
      ? fallbackParent?.id ||
        items.find((item) => !recordIds.has(item.id) && !item.parent)?.id ||
        items.find((item) => !recordIds.has(item.id))?.id ||
        null
      : record?.id || null;
    const deletedIds = new Set();
    setSaving(true);
    setError("");
    try {
      for (const item of deletionOrder) {
        await api.remove(activeCollection, item.id);
        deletedIds.add(item.id);
      }
      if (currentWillBeDeleted) {
        setDirty(false);
        await loadCollection(activeCollection, nextId);
      } else {
        setItems((current) =>
          current.filter((item) => !recordIds.has(item.id))
        );
        const nextSelection = record
          ? new Set([record.id])
          : new Set();
        setSelectedRecordIds(nextSelection);
        setRecordSelectionAnchor(record?.id || "");
        setActiveTreeSelection("collection");
      }
      showToast(
        `${selectedItems.length} ${selectedItems.length === 1 ? "record" : "records"} deleted`
      );
    } catch (deleteError) {
      if (deletedIds.size) {
        setItems((current) =>
          current.filter((item) => !deletedIds.has(item.id))
        );
        setSelectedRecordIds(
          new Set(
            [...recordIds].filter((id) => !deletedIds.has(id))
          )
        );
        if (record && deletedIds.has(record.id)) {
          setDirty(false);
          await loadCollection(activeCollection);
        }
      }
      throw deleteError;
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteRecords(recordIds) {
    if (!recordIds.size || saving) return;
    const selectedItems = items.filter((item) => recordIds.has(item.id));
    if (!selectedItems.length) return;
    const selectedHierarchyIds = new Set(
      selectedItems.map((item) => item.hierarchy_id || item.id)
    );
    const unselectedChildren = items.filter(
      (item) =>
        item.parent &&
        selectedHierarchyIds.has(item.parent) &&
        !recordIds.has(item.id)
    );
    if (unselectedChildren.length) {
      const parentCount = new Set(
        unselectedChildren.map((item) => item.parent)
      ).size;
      setError(
        `Select or move all children before deleting ${parentCount === 1 ? "this parent" : "these parents"}.`
      );
      return;
    }

    const count = selectedItems.length;
    const singular = collection?.label_singular?.toLowerCase() || "record";
    const plural = collection?.label?.toLowerCase() || "records";
    setConfirmation({
      title: `Delete ${count} ${count === 1 ? singular : plural}?`,
      description:
        count === 1
          ? `This permanently removes “${selectedItems[0].title}” and its YAML file.`
          : `This permanently removes the ${count} selected records and their YAML files.`,
      confirmLabel: count === 1 ? `Delete ${singular}` : `Delete ${count} records`,
      danger: true,
      onConfirm: () => deleteRecords(new Set(recordIds))
    });
  }

  function requestDeleteSelectedRecords() {
    requestDeleteRecords(selectedRecordIds);
  }

  function requestDeleteCurrentRecord() {
    if (!record) return;
    requestDeleteRecords(new Set([record.id]));
  }

  function duplicateSelectedContent() {
    if (!record || !selectedContentIds.size) return;
    const selectedNodes = selectedTopLevelContentNodes(
      record,
      selectedContentIds,
      true
    );
    if (selectedNodes[0]?.id === record.id) {
      duplicateCurrentRecord();
      return;
    }
    setActiveTreeSelection("content");
    const usedIds = collectNodeIds(record);
    const duplicateBySourceId = new Map();
    const parentIds = new Set();
    for (const node of selectedNodes) {
      const location = findLocation(record, node.id);
      if (!location) continue;
      const duplicate = cloneContentNode(node, usedIds);
      refreshUuidFields(duplicate, nodeTypes);
      if (duplicate.properties?.heading) {
        duplicate.properties.heading = `${duplicate.properties.heading} duplicate`;
      }
      duplicateBySourceId.set(node.id, duplicate);
      parentIds.add(location.parentId);
    }
    if (!duplicateBySourceId.size) return;

    const insertDuplicates = (node) => ({
      ...node,
      slots: Object.fromEntries(
        Object.entries(node.slots ?? {}).map(([slotName, children]) => [
          slotName,
          children.flatMap((child) => {
            const current = insertDuplicates(child);
            const duplicate = duplicateBySourceId.get(child.id);
            return duplicate ? [current, duplicate] : [current];
          })
        ])
      )
    });
    changeRecord(insertDuplicates);
    const duplicates = [...duplicateBySourceId.values()];
    const duplicateIds = duplicates.map((duplicate) => duplicate.id);
    setContentExpanded(
      (current) => new Set([...current, ...parentIds])
    );
    setSelectedId(duplicateIds.at(-1));
    setSelectedContentIds(new Set(duplicateIds));
    setContentSelectionAnchor(duplicateIds[0]);
    showToast(
      `${duplicateIds.length} content ${duplicateIds.length === 1 ? "item" : "items"} duplicated`
    );
  }

  function deleteTreeSelection() {
    requestDeleteSelectedContent();
  }

  function insertContentNode({ choice }) {
    setActiveTreeSelection("content");
    const node = newNode(choice.typeName, nodeTypes[choice.typeName]);
    changeRecord((current) =>
      updateNode(current, choice.parentId, (parent) => {
        const children = [...(parent.slots?.[choice.slotName] ?? [])];
        children.splice(choice.index, 0, node);
        return {
          ...parent,
          slots: { ...(parent.slots ?? {}), [choice.slotName]: children }
        };
      })
    );
    setContentExpanded((current) => new Set([...current, choice.parentId]));
    setSelectedId(node.id);
    setSelectedContentIds(new Set([node.id]));
    setContentSelectionAnchor(node.id);
    setInsertDialog(null);
    showToast(`${nodeTypes[node.type]?.label || node.type} inserted`);
  }

  function moveContentByDrag(drag, drop) {
    if (!record || !drag?.source || drop?.kind !== "content-drop") return;
    if (drag.nodeId === drop.targetId) return;
    const source = drag.source;
    const targetParent = getNode(record, drop.parentId);
    const targetChildren = targetParent?.slots?.[drop.slotName] ?? [];
    let targetIndex =
      drop.position === "inside"
        ? targetChildren.length
        : targetChildren.findIndex((child) => child.id === drop.targetId);
    if (targetIndex === -1) return;
    if (drop.position === "after") targetIndex += 1;
    const sameSlot =
      source.parentId === drop.parentId && source.slotName === drop.slotName;
    if (sameSlot && source.index < targetIndex) targetIndex -= 1;
    if (sameSlot && source.index === targetIndex) return;
    setActiveTreeSelection("content");

    const movingNode = getNode(record, drag.nodeId);
    if (!movingNode) return;
    changeRecord((current) => {
      const withoutSource = updateNode(current, source.parentId, (parent) => ({
        ...parent,
        slots: {
          ...parent.slots,
          [source.slotName]: parent.slots[source.slotName].filter(
            (child) => child.id !== drag.nodeId
          )
        }
      }));
      return updateNode(withoutSource, drop.parentId, (parent) => {
        const children = [...(parent.slots?.[drop.slotName] ?? [])];
        children.splice(targetIndex, 0, movingNode);
        return {
          ...parent,
          slots: { ...(parent.slots ?? {}), [drop.slotName]: children }
        };
      });
    });
    setContentExpanded((current) => new Set([...current, drop.parentId]));
    setSelectedId(drag.nodeId);
    if (!selectedContentIds.has(drag.nodeId)) {
      setSelectedContentIds(new Set([drag.nodeId]));
      setContentSelectionAnchor(drag.nodeId);
    }
    showToast(`${drag.label} moved`);
  }

  async function moveCollectionByDrag(drag, drop) {
    if (dirty || saving || drop?.kind !== "collection-drop") return;
    const draggedItem = drag?.item;
    if (!draggedItem || draggedItem.id === drop.targetId) return;

    const siblings = items
      .filter(
        (item) =>
          item.id !== draggedItem.id && (item.parent ?? null) === (drop.parent ?? null)
      )
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    let targetIndex =
      drop.position === "inside"
        ? siblings.length
        : siblings.findIndex((item) => item.id === drop.targetId);
    if (targetIndex === -1) return;
    if (drop.position === "after") targetIndex += 1;
    const previous = targetIndex > 0 ? siblings[targetIndex - 1] : null;
    const next = targetIndex < siblings.length ? siblings[targetIndex] : null;
    const order =
      previous && next
        ? ((previous.order ?? 0) + (next.order ?? 0)) / 2
        : previous
          ? (previous.order ?? 0) + 1
          : next
            ? (next.order ?? 0) - 1
            : 0;

    setSaving(true);
    setError("");
    try {
      const sourceRecord =
        record?.id === draggedItem.id
          ? structuredClone(record)
          : await api.record(activeCollection, draggedItem.id);
      sourceRecord.order = order;
      const parentField = collection.hierarchy?.parent_field;
      if (parentField) {
        sourceRecord.properties = {
          ...(sourceRecord.properties ?? {}),
          [parentField]: drop.parent ?? null
        };
      } else {
        sourceRecord.parent = drop.parent ?? null;
      }

      const result = await api.save(activeCollection, sourceRecord);
      setItems((current) =>
        current.map((item) => (item.id === result.item.id ? result.item : item))
      );
      if (record?.id === sourceRecord.id) {
        setRecord(sourceRecord);
        setDirty(false);
      }
      if (drop.parent) {
        const parentItem = items.find(
          (item) => (item.hierarchy_id || item.id) === drop.parent
        );
        if (parentItem) {
          setPageExpanded((current) => new Set([...current, parentItem.id]));
        }
      }
      showToast(`${draggedItem.title} moved`);
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setSaving(false);
    }
  }

  function moveSelected(direction) {
    const location = findLocation(record, selectedId);
    if (!location) return;
    const destination = location.index + direction;
    if (destination < 0 || destination >= location.children.length) return;
    changeRecord((current) =>
      updateNode(current, location.parentId, (parent) => {
        const children = [...parent.slots[location.slotName]];
        const [moving] = children.splice(location.index, 1);
        children.splice(destination, 0, moving);
        return {
          ...parent,
          slots: { ...parent.slots, [location.slotName]: children }
        };
      })
    );
  }

  function deleteSelectedContent(nodes, selectedCount) {
    if (!record || !nodes.length) return;
    const deletedIds = new Set(nodes.map((node) => node.id));
    const firstLocation = findLocation(record, nodes[0].id);
    const nextSelectedId = firstLocation?.parentId || record.id;
    const removeNodes = (node) => ({
      ...node,
      slots: Object.fromEntries(
        Object.entries(node.slots ?? {}).map(([slotName, children]) => [
          slotName,
          children
            .filter((child) => !deletedIds.has(child.id))
            .map(removeNodes)
        ])
      )
    });
    setActiveTreeSelection("content");
    changeRecord(removeNodes);
    setSelectedId(nextSelectedId);
    setSelectedContentIds(new Set([nextSelectedId]));
    setContentSelectionAnchor(nextSelectedId);
    showToast(
      `${selectedCount} content ${selectedCount === 1 ? "item" : "items"} deleted`
    );
  }

  function requestDeleteSelectedContent() {
    if (!record || !selectedContentIds.size || saving) return;
    const selectedNodes = selectedTopLevelContentNodes(
      record,
      selectedContentIds,
      true
    );
    if (!selectedNodes.length) return;
    if (selectedNodes[0].id === record.id) {
      requestDeleteCurrentRecord();
      return;
    }
    const count = selectedContentIds.size;
    const nestedNote = selectedNodes.some(
      (node) => descendantIds(node).size
    )
      ? " Nested content inside them will also be removed."
      : "";
    setConfirmation({
      title: `Delete ${count} content ${count === 1 ? "item" : "items"}?`,
      description: `This removes the selected content from the current record.${nestedNote}`,
      confirmLabel: count === 1 ? "Delete item" : `Delete ${count} items`,
      danger: true,
      onConfirm: () => deleteSelectedContent(selectedNodes, count)
    });
  }

  function toggleSet(setter, id) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!config && loading) {
    return (
      <div className="boot-screen">
        <BrandMark />
        <Spinner />
        <span>Opening miniCMS</span>
      </div>
    );
  }

  if (!config && error) {
    return (
      <div className="boot-screen boot-screen--error">
        <CircleAlert size={28} />
        <strong>Could not open the studio</strong>
        <p>{error}</p>
        <button type="button" className="button button--primary" onClick={() => location.reload()}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <nav className="collection-nav" aria-label="Collections">
          {collections.map((entry) => {
            const Icon = iconFor(entry.icon, Files);
            return (
              <button
                type="button"
                key={entry.name}
                className={cx(entry.name === activeCollection && "is-active")}
                onClick={() => switchCollection(entry.name)}
              >
                <Icon size={15} strokeWidth={1.8} />
                {entry.label}
              </button>
            );
          })}
          <button
            type="button"
            className="collection-nav__settings"
            onClick={() =>
              runAfterDiscardCheck(() => setSettingsOpen(true))
            }
          >
            <Settings2 size={15} strokeWidth={1.8} />
            Settings
          </button>
        </nav>

        <div className="topbar__actions">
          <span className={cx("save-state", dirty && "save-state--dirty")}>
            <i />
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            type="button"
            className="button button--save"
            onClick={saveRecord}
            disabled={!record || !dirty || saving}
          >
            {saving ? <Spinner small /> : dirty ? <Save size={15} /> : <Check size={15} />}
            {saving ? "Saving" : "Save"}
          </button>
          <button
            type="button"
            className={cx(
              "adapter-account",
              adapterSession.authenticated && "is-authenticated"
            )}
            title={
              api.name === "github"
                ? adapterSession.authenticated
                  ? `Sign out ${adapterSession.login || "GitHub"}`
                  : "Sign in with GitHub"
                : "Local Node server"
            }
            aria-label={
              api.name === "github"
                ? adapterSession.authenticated
                  ? `Sign out ${adapterSession.login || "GitHub"}`
                  : "Sign in with GitHub"
                : "Local Node server"
            }
            disabled={api.name !== "github" || authenticating}
            onClick={toggleAdapterSession}
          >
            {authenticating ? (
              <Spinner small />
            ) : adapterSession.avatarUrl ? (
              <img src={adapterSession.avatarUrl} alt="" />
            ) : api.name === "github" ? (
              <Github size={16} />
            ) : (
              <HardDrive size={15} />
            )}
            <span>{adapterSession.label}</span>
          </button>
        </div>
      </header>

      <main
        ref={workspaceRef}
        className={cx("workspace", isTableView && "workspace--table")}
        style={workspaceStyle}
      >
        {isTableView && (
          <CollectionTable
            key={collection.name}
            collection={collection}
            items={treeItems}
            nodeTypes={nodeTypes}
            selectedId={record?.id}
            loading={loading}
            search={search}
            editing={saving}
            onSearch={setSearch}
            onSelect={selectRecord}
            onCreate={() => setInsertDialog("collection")}
            onEdit={editTableField}
          />
        )}

        {!isTableView && (
          <aside ref={leftRailRef} className="left-rail">
          <section className="rail-section rail-section--documents">
            <div className="panel-heading">
              <div>
                <span>{collection?.label}</span>
                <small>{items.length}</small>
              </div>
            </div>
            <div className="document-toolbar" aria-label="Document actions">
              <button
                type="button"
                title={`New ${collection?.label_singular}`}
                onClick={() => setInsertDialog("collection")}
              >
                <Plus size={18} />
              </button>
              {documentHasHidden && (
                <button
                  type="button"
                  className={cx(record?.properties?.hidden && "is-active")}
                  title={
                    record?.properties?.hidden
                      ? "Show page"
                      : "Hide page"
                  }
                  disabled={!record}
                  onClick={toggleDocumentVisibility}
                >
                  {record?.properties?.hidden ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              )}
              <span className="document-toolbar__separator" />
              <button
                type="button"
                title={`Duplicate selected ${collection?.label?.toLowerCase()}`}
                disabled={!selectedRecordIds.size || saving}
                onClick={duplicateSelectedRecords}
              >
                <Copy size={18} />
              </button>
              <button
                type="button"
                title={`Copy selected ${collection?.label?.toLowerCase()}`}
                disabled={!selectedRecordIds.size || clipboardBusy}
                onClick={copySelectedRecords}
              >
                <ClipboardCopy size={18} />
              </button>
              <button
                type="button"
                title={`Paste copied ${collection?.label?.toLowerCase()}`}
                disabled={
                  !collectionPasteContext ||
                  dirty ||
                  saving ||
                  clipboardBusy
                }
                onClick={pasteCopiedRecords}
              >
                <ClipboardPaste size={18} />
              </button>
              <button
                type="button"
                className="danger"
                title={`Delete selected ${collection?.label?.toLowerCase()}`}
                disabled={!selectedRecordIds.size || saving}
                onClick={requestDeleteSelectedRecords}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="search">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Find ${collection?.label.toLowerCase()}…`}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="rail-scroll" onClick={clearCollectionSelection}>
              <CollectionTree
                items={treeItems}
                collection={collection}
                selectedIds={selectedRecordIds}
                selectionAnchor={recordSelectionAnchor}
                onSelectionChange={changeCollectionSelection}
                expanded={pageExpanded}
                onToggle={(id) => toggleSet(setPageExpanded, id)}
                onMove={moveCollectionByDrag}
                dragEnabled={!dirty && !saving}
                search={search}
              />
            </div>
          </section>

          <ResizeHandle
            axis="y"
            label="Resize collection and content trees"
            onResize={resizeTreeSplit}
          />

          <section className="rail-section rail-section--structure">
            <div className="panel-heading">
              <div>
                <span>Content structure</span>
                {record && (
                  <small>
                    {record.slots
                      ? Object.values(record.slots).reduce(
                          (total, children) => total + children.length,
                          0
                        )
                      : 0}
                  </small>
                )}
              </div>
              <button type="button" className="icon-button" title="Structure options">
                <MoreHorizontal size={16} />
              </button>
            </div>
            <div className="document-toolbar content-toolbar" aria-label="Content node actions">
              <button
                type="button"
                title="Insert content"
                disabled={!record}
                onClick={() => setInsertDialog("content")}
              >
                <Plus size={18} />
              </button>
              {selectedNodeHasHidden && (
                <button
                  type="button"
                  className={cx(selectedNode?.properties?.hidden && "is-active")}
                  title={selectedNode?.properties?.hidden ? "Show content" : "Hide content"}
                  disabled={!selectedNode}
                  onClick={toggleSelectedVisibility}
                >
                  {selectedNode?.properties?.hidden ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              )}
              <span className="document-toolbar__separator" />
              <button
                type="button"
                title="Duplicate selected content"
                disabled={!selectedContentIds.size || saving}
                onClick={duplicateSelectedContent}
              >
                <Copy size={18} />
              </button>
              <button
                type="button"
                title="Copy selected content"
                disabled={!copyableContentNodes.length}
                onClick={copySelectedContent}
              >
                <ClipboardCopy size={18} />
              </button>
              <button
                type="button"
                title="Paste copied content"
                disabled={!contentPasteDestination}
                onClick={pasteCopiedContent}
              >
                <ClipboardPaste size={18} />
              </button>
              <button
                type="button"
                className="danger"
                title="Delete selected content"
                disabled={!selectedContentIds.size || saving}
                onClick={deleteTreeSelection}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="rail-scroll" onClick={clearContentSelection}>
              {loading && !record ? (
                <div className="panel-loader">
                  <Spinner />
                </div>
              ) : record ? (
                <ContentTree
                  record={record}
                  nodeTypes={nodeTypes}
                  selectedIds={selectedContentIds}
                  selectionAnchor={contentSelectionAnchor}
                  onSelectionChange={changeContentSelection}
                  expanded={contentExpanded}
                  onToggle={(id) => toggleSet(setContentExpanded, id)}
                  onMove={moveContentByDrag}
                  dragEnabled={!saving}
                />
              ) : (
                <EmptyState title="No item selected" />
              )}
            </div>
          </section>
          </aside>
        )}

        {!isTableView && (
          <ResizeHandle
            axis="x"
            label="Resize collection trees and preview"
            onResize={resizeTreeLeft}
          />
        )}

        {!isTableView && (
          <section className="center-pane">
            <div className="pane-heading">
              <div className="breadcrumbs" ref={breadcrumbRef}>
                <span>{collection?.label}</span>
                {selectedNodePath.length ? (
                  selectedNodePath.map((node, index) => {
                    const label =
                      index === 0
                        ? node.properties?.title || node.id
                        : nodeTypes[node.type]?.label || node.type;
                    const isCurrent = index === selectedNodePath.length - 1;
                    return (
                      <span className="breadcrumb-segment" key={node.id}>
                        <ChevronRight size={13} />
                        {isCurrent ? (
                          <strong title={label}>{label}</strong>
                        ) : (
                          <span title={label}>{label}</span>
                        )}
                      </span>
                    );
                  })
                ) : (
                  <span className="breadcrumb-segment">
                    <ChevronRight size={13} />
                    <strong>No selection</strong>
                  </span>
                )}
              </div>
              <div className="pane-heading__right">
                <span className="status-pill">
                  <i />
                  Draft workspace
                </span>
              </div>
            </div>
            {record ? (
              <Preview
                record={record}
                selectedId={selectedId}
                nodeTypes={nodeTypes}
                siteName={config.site?.name}
              />
            ) : (
              <EmptyState title={`No ${collection?.label_singular?.toLowerCase()} selected`} />
            )}
          </section>
        )}

        <ResizeHandle
          axis="x"
          label={
            isTableView
              ? "Resize table and inspector"
              : "Resize preview and inspector"
          }
          onResize={resizeInspector}
        />

        <aside className="right-rail">
          <div className="pane-heading">
            {multipleTreeSelection ? (
              <strong className="inspector-selection-title">Selection</strong>
            ) : (
              <div className="inspector-tabs">
                {inspectorPanels.map((panel) => (
                  <button
                    type="button"
                    key={panel.name}
                    className={cx(effectivePanel === panel.name && "is-active")}
                    onClick={() => setActivePanel(panel.name)}
                  >
                    {panel.label}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="icon-button" title="Collapse inspector">
              <Menu size={16} />
            </button>
          </div>
          {multipleTreeSelection ? (
            <MultiSelectionNotice
              count={multipleTreeSelection.count}
              label={multipleTreeSelection.label}
              icon={multipleTreeSelection.icon}
            />
          ) : loading && !record ? (
            <div className="panel-loader">
              <Spinner />
            </div>
          ) : (
            <Inspector
              record={record}
              selectedId={selectedId}
              nodeTypes={nodeTypes}
              collection={collection}
              collections={collections}
              items={items}
              activePanel={effectivePanel}
              onPropertyChange={changeProperty}
              onMove={moveSelected}
              onDelete={requestDeleteSelectedContent}
              onDuplicate={duplicateSelectedContent}
              onDuplicateRecord={duplicateCurrentRecord}
              onDeleteRecord={requestDeleteCurrentRecord}
              onRenameFile={regenerateRecordFilename}
              renameDisabled={saving}
            />
          )}
        </aside>
      </main>

      {error && (
        <div className="error-banner">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}

      {toast && (
        <div className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}

      {insertDialog && (
        <InsertionDialog
          kind={insertDialog}
          modes={
            insertDialog === "collection"
              ? collectionInsertModes
              : contentInsertModes
          }
          nodeTypes={nodeTypes}
          collection={insertDialog === "collection" ? collection : undefined}
          collections={collections}
          existingIds={items.map((item) => item.id)}
          onCancel={() => setInsertDialog(null)}
          onInsert={
            insertDialog === "collection"
              ? insertCollectionItem
              : insertContentNode
          }
        />
      )}

      {confirmation && (
        <ConfirmationDialog
          {...confirmation}
          onCancel={() => setConfirmation(null)}
        />
      )}

      {settingsOpen && (
        <ConfigurationEditor
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={saveConfiguration}
        />
      )}

    </div>
  );
}
