import React, { useState } from 'react';
import { message, Button, Modal, Select, Typography, Tag as CustomTag } from 'antd';
import styled from 'styled-components';

import { useGetSearchResultsLazyQuery } from '../../../graphql/search.generated';
import { EntityType, SubResourceType, SearchResult, Tag, GlossaryTerm } from '../../../types.generated';
import CreateTagModal from './CreateTagModal';
import { useEntityRegistry } from '../../useEntityRegistry';
import { useAddTagsMutation, useAddTermsMutation } from '../../../graphql/mutations.generated';
import analytics, { EventType, EntityActionType } from '../../analytics';
import { useEnterKeyListener } from '../useEnterKeyListener';
import TermLabel from '../TermLabel';
import TagLabel from '../TagLabel';

type AddTagsModalProps = {
    visible: boolean;
    onCloseModal: () => void;
    entityUrn: string;
    entityType: EntityType;
    entitySubresource?: string;
    type?: EntityType;
};

const TagSelect = styled(Select)`
    width: 480px;
`;

const CREATE_TAG_VALUE = '____reserved____.createTagValue';

export default function AddTagsTermsModal({
    visible,
    onCloseModal,
    entityUrn,
    entityType,
    entitySubresource,
    type = EntityType.Tag,
}: AddTagsModalProps) {
    const entityRegistry = useEntityRegistry();
    const [inputValue, setInputValue] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [disableAdd, setDisableAdd] = useState(false);
    const [urns, setUrns] = useState<string[]>([]);

    const [addTagsMutation] = useAddTagsMutation();
    const [addTermsMutation] = useAddTermsMutation();

    const [tagTermSearch, { data: tagTermSearchData }] = useGetSearchResultsLazyQuery();
    const tagSearchResults = tagTermSearchData?.search?.searchResults || [];

    const handleSearch = (text: string) => {
        if (text.length > 0) {
            tagTermSearch({
                variables: {
                    input: {
                        type,
                        query: text,
                        start: 0,
                        count: 10,
                    },
                },
            });
        }
    };

    const renderSearchResult = (result: SearchResult) => {
        const displayName =
            result.entity.type === EntityType.Tag
                ? (result.entity as Tag).name
                : (result.entity as GlossaryTerm).hierarchicalName;
        const tagOrTermComponent =
            result.entity.type === EntityType.Tag ? (
                <TagLabel
                    name={displayName}
                    colorHash={(result.entity as Tag).urn}
                    color={(result.entity as Tag).properties?.colorHex}
                />
            ) : (
                <TermLabel name={displayName} />
            );
        return (
            <Select.Option value={result.entity.urn} key={result.entity.urn}>
                {tagOrTermComponent}
            </Select.Option>
        );
    };

    const tagSearchOptions = tagSearchResults.map((result) => {
        return renderSearchResult(result);
    });

    const inputExistsInTagSearch = tagSearchResults.some((result: SearchResult) => {
        const displayName = entityRegistry.getDisplayName(result.entity.type, result.entity);
        return displayName.toLowerCase() === inputValue.toLowerCase();
    });

    if (!inputExistsInTagSearch && inputValue.length > 0 && type === EntityType.Tag && urns.length === 0) {
        tagSearchOptions.push(
            <Select.Option value={CREATE_TAG_VALUE} key={CREATE_TAG_VALUE}>
                <Typography.Link> Create {inputValue}</Typography.Link>
            </Select.Option>,
        );
    }

    const tagRender = (props) => {
        // eslint-disable-next-line react/prop-types
        const { label, closable, onClose } = props;
        const onPreventMouseDown = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        return (
            <CustomTag
                onMouseDown={onPreventMouseDown}
                closable={closable}
                onClose={onClose}
                style={{
                    marginRight: 3,
                    display: 'flex',
                    justifyContent: 'start',
                    alignItems: 'center',
                    whiteSpace: 'nowrap',
                    opacity: 1,
                    color: '#434343',
                    lineHeight: '16px',
                }}
            >
                {label}
            </CustomTag>
        );
    };

    // Handle the Enter press
    useEnterKeyListener({
        querySelectorToExecuteClick: '#addTagButton',
    });

    if (showCreateModal) {
        return (
            <CreateTagModal
                visible={visible}
                onClose={onCloseModal}
                onBack={() => setShowCreateModal(false)}
                tagName={inputValue}
                entityUrn={entityUrn}
                entitySubresource={entitySubresource}
            />
        );
    }

    // When a Tag or term search result is selected, add the urn to the Urns
    const onSelectValue = (urn: string) => {
        if (urn === CREATE_TAG_VALUE) {
            setShowCreateModal(true);
            return;
        }
        const newUrns = [...(urns || []), urn];
        setUrns(newUrns);
    };

    // When a Tag or term search result is deselected, remove the urn from the Owners
    const onDeselectValue = (urn: string) => {
        const newUrns = urns?.filter((u) => u !== urn);
        setUrns(newUrns);
    };

    // Function to handle the modal action's
    const onOk = () => {
        let mutation: ((input: any) => Promise<any>) | null = null;
        if (type === EntityType.Tag) {
            mutation = addTagsMutation;
        }
        if (type === EntityType.GlossaryTerm) {
            mutation = addTermsMutation;
        }

        if (!entityUrn || !mutation) {
            onCloseModal();
            return;
        }
        setDisableAdd(true);

        let input = {};
        let actionType = EntityActionType.UpdateSchemaTags;
        if (type === EntityType.Tag) {
            input = {
                tagUrns: urns,
                resourceUrn: entityUrn,
                subResource: entitySubresource,
                subResourceType: entitySubresource ? SubResourceType.DatasetField : null,
            };
            if (entitySubresource) {
                actionType = EntityActionType.UpdateSchemaTags;
            } else {
                actionType = EntityActionType.UpdateTags;
            }
        }
        if (type === EntityType.GlossaryTerm) {
            input = {
                termUrns: urns,
                resourceUrn: entityUrn,
                subResource: entitySubresource,
                subResourceType: entitySubresource ? SubResourceType.DatasetField : null,
            };
            if (entitySubresource) {
                actionType = EntityActionType.UpdateSchemaTerms;
            } else {
                actionType = EntityActionType.UpdateTerms;
            }
        }

        analytics.event({
            type: EventType.EntityActionEvent,
            entityType,
            entityUrn,
            actionType,
        });

        mutation({
            variables: {
                input,
            },
        })
            .then(({ errors }) => {
                if (!errors) {
                    message.success({
                        content: `Added ${type === EntityType.GlossaryTerm ? 'Terms' : 'Tags'}!`,
                        duration: 2,
                    });
                }
            })
            .catch((e) => {
                message.destroy();
                message.error({ content: `Failed to add: \n ${e.message || ''}`, duration: 3 });
            })
            .finally(() => {
                setDisableAdd(false);
                onCloseModal();
                setUrns([]);
            });
    };

    return (
        <Modal
            title={`Add ${entityRegistry.getEntityName(type)}s`}
            visible={visible}
            onCancel={onCloseModal}
            okButtonProps={{ disabled: urns.length === 0 }}
            okText="Add"
            footer={
                <>
                    <Button onClick={onCloseModal} type="text">
                        Cancel
                    </Button>
                    <Button
                        id="addTagButton"
                        data-testid="add-tag-term-from-modal-btn"
                        onClick={onOk}
                        disabled={urns.length === 0 || disableAdd}
                    >
                        Add
                    </Button>
                </>
            }
        >
            <TagSelect
                autoFocus
                mode="multiple"
                filterOption={false}
                placeholder={`Search for ${entityRegistry.getEntityName(type)?.toLowerCase()}...`}
                showSearch
                defaultActiveFirstOption={false}
                onSelect={(asset: any) => onSelectValue(asset)}
                onDeselect={(asset: any) => onDeselectValue(asset)}
                onSearch={(value: string) => {
                    // eslint-disable-next-line react/prop-types
                    handleSearch(value.trim());
                    // eslint-disable-next-line react/prop-types
                    setInputValue(value.trim());
                }}
                tagRender={tagRender}
            >
                {tagSearchOptions}
            </TagSelect>
        </Modal>
    );
}
